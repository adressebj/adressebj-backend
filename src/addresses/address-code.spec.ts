import {
  buildAssembledText,
  CODE_ALPHABET,
  generateSequence,
} from './address-code';

describe('generateSequence', () => {
  it('produit 4 caractères de l’alphabet épuré, sur 1000 tirages', () => {
    const forbidden = /[0OIL]/;
    for (let i = 0; i < 1000; i++) {
      const seq = generateSequence();
      expect(seq).toHaveLength(4);
      expect(forbidden.test(seq)).toBe(false);
      for (const ch of seq) expect(CODE_ALPHABET).toContain(ch);
    }
  });
});

describe('buildAssembledText', () => {
  it('assemble les étapes avec ". " et termine par un point', () => {
    expect(buildAssembledText(['Tourner à gauche', 'Maison bleue'])).toBe(
      'Tourner à gauche. Maison bleue.',
    );
  });

  it('nettoie les espaces et ignore les étapes vides', () => {
    expect(buildAssembledText(['  Étape 1  ', '', '   ', 'Étape 2'])).toBe(
      'Étape 1. Étape 2.',
    );
  });

  it('renvoie une chaîne vide si aucune étape exploitable', () => {
    expect(buildAssembledText([])).toBe('');
    expect(buildAssembledText(['  ', ''])).toBe('');
  });
});
