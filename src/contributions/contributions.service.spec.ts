import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service';
import { ContributionsService } from './contributions.service';

describe('ContributionsService', () => {
  let prisma: { contribution: { create: jest.Mock } };
  let addresses: { resolvePublishedAddress: jest.Mock };
  let service: ContributionsService;

  beforeEach(() => {
    prisma = { contribution: { create: jest.fn() } };
    addresses = { resolvePublishedAddress: jest.fn() };
    service = new ContributionsService(
      prisma as never,
      addresses as unknown as AddressesService,
    );
  });

  it('crée une contribution PENDING (message nettoyé)', async () => {
    addresses.resolvePublishedAddress.mockResolvedValue({
      id: 'addr-1',
      code: 'AKP-1234',
      ownerId: 'owner-1',
    });
    prisma.contribution.create.mockResolvedValue({ id: 'c-1' });

    const res = await service.create('user-1', 'AKP-1234', '  Sens unique  ');

    expect(res).toEqual({ contributionId: 'c-1', status: 'PENDING' });
    expect(prisma.contribution.create).toHaveBeenCalledWith({
      data: { addressId: 'addr-1', userId: 'user-1', message: 'Sens unique' },
    });
  });

  it.each(['', '   '])(
    'message vide/blanc → CONTRIBUTION_MESSAGE_REQUIRED (avant résolution)',
    async (message) => {
      await expect(
        service.create('user-1', 'AKP-1234', message),
      ).rejects.toMatchObject({
        response: { code: 'CONTRIBUTION_MESSAGE_REQUIRED' },
      });
      expect(addresses.resolvePublishedAddress).not.toHaveBeenCalled();
      expect(prisma.contribution.create).not.toHaveBeenCalled();
    },
  );

  it('propage le 404 d’une adresse non publiée', async () => {
    addresses.resolvePublishedAddress.mockRejectedValue(
      new NotFoundException({ code: 'ADDRESS_NOT_FOUND' }),
    );
    await expect(
      service.create('user-1', 'XXX-0000', 'Une note'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.contribution.create).not.toHaveBeenCalled();
  });

  it('BadRequestException est bien le type levé pour message vide', async () => {
    await expect(service.create('user-1', 'AKP-1234', '')).rejects.toThrow(
      BadRequestException,
    );
  });
});
