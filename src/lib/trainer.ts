/**
 * The trainer's identity, kept separate from the prompt builder.
 *
 * Client components need the name for labels. Importing it from the prompt
 * module would pull every prompt string into the browser bundle for no reason.
 */
export const TRAINER_NAME = 'Nova';
