/**
 * Génération du code adresse et assemblage du texte d'instructions.
 * Format du code : [PRÉFIXE-QUARTIER]-[SÉQUENCE-4CAR], base 32 épurée.
 */

// Alphabet épuré : 0, O, I, L exclus (confusion visuelle).
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_SEQUENCE_LENGTH = 4;

/** Séquence aléatoire de 4 caractères dans l'alphabet épuré. */
export function generateSequence(): string {
  let result = '';
  for (let i = 0; i < CODE_SEQUENCE_LENGTH; i++) {
    result += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return result;
}

/** Assemble les étapes en un texte d'instructions. Recalculé à chaque modification. */
export function buildAssembledText(steps: string[]): string {
  const cleaned = steps.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  return cleaned.join('. ') + '.';
}
