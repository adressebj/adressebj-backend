import { pointInPolygon } from './point-in-polygon';

// Carré [lng,lat] de (0,0) à (10,10).
const ring = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
  [0, 0],
];

describe('pointInPolygon', () => {
  it('détecte un point intérieur (anneau brut)', () => {
    expect(pointInPolygon([5, 5], ring)).toBe(true);
  });

  it('détecte un point extérieur', () => {
    expect(pointInPolygon([15, 5], ring)).toBe(false);
  });

  it('accepte un polygone GeoJSON { type, coordinates }', () => {
    const geo = { type: 'Polygon', coordinates: [ring] };
    expect(pointInPolygon([5, 5], geo)).toBe(true);
    expect(pointInPolygon([-1, -1], geo)).toBe(false);
  });

  it('renvoie false pour un polygone absent ou mal formé', () => {
    expect(pointInPolygon([5, 5], null)).toBe(false);
    expect(pointInPolygon([5, 5], {})).toBe(false);
    expect(pointInPolygon([5, 5], [[0, 0]])).toBe(false);
  });
});
