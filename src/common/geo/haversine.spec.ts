import { distanceMeters } from './haversine';

describe('distanceMeters (Haversine)', () => {
  it('renvoie 0 pour deux points identiques', () => {
    expect(distanceMeters(6.37, 2.42, 6.37, 2.42)).toBe(0);
  });

  it('≈ 111.2 km pour 1° de longitude à l’équateur', () => {
    expect(distanceMeters(0, 0, 0, 1)).toBeCloseTo(111195, -2); // ±~100 m
  });

  it('mesure une petite distance plausible (~15 m)', () => {
    // ~0.000135° de latitude ≈ 15 m
    const d = distanceMeters(6.366, 2.444, 6.366 + 0.000135, 2.444);
    expect(d).toBeGreaterThan(13);
    expect(d).toBeLessThan(17);
  });

  it('est symétrique', () => {
    const a = distanceMeters(6.1, 2.1, 6.2, 2.2);
    const b = distanceMeters(6.2, 2.2, 6.1, 2.1);
    expect(a).toBeCloseTo(b, 6);
  });
});
