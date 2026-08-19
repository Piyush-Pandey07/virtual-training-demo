/** Shared types for the training session, used on both the client and the server. */

/** What the trainer has been asked to produce on this turn. */
export type TurnKind =
  /** Teach the current slide from scratch. */
  | 'narrate'
  /** Answer a question the trainee asked. */
  | 'answer'
  /** Close the session with a recap. */
  | 'recap'
  /** Put a short set of check questions to the trainee. */
  | 'quiz';

/**
 * The shape of answer a question is asking for. Detected from the wording, so a
 * request to simplify and a request to go deeper get genuinely different replies.
 */
export type AnswerStyle = 'default' | 'simpler' | 'example' | 'standard' | 'deeper';

/**
 * A running read on the trainee, so the trainer adapts across the session rather
 * than treating every turn as the first one.
 */
export interface LearnerProfile {
  /** How many questions they have asked. */
  questionsAsked: number;
  /** Slides they have asked about, most engaged first is not required. */
  curiousAbout: number[];
  /** They have asked for something to be simplified at least once. */
  prefersSimpler: boolean;
  /** They have asked for more depth at least once. */
  prefersDepth: boolean;
  /** They have asked about the standard itself, so clause references are welcome. */
  askedForStandard: boolean;
}

/** Who said a given line. */
export type Speaker = 'trainer' | 'trainee';

/** One line of the running conversation. */
export interface TranscriptEntry {
  id: string;
  speaker: Speaker;
  text: string;
  /** Slide that was on screen when the line was said. */
  slideId: number;
  /** Epoch milliseconds. */
  at: number;
  /** True while speech to text is still refining this line. */
  interim?: boolean;
}

/** Compact history entry sent to the model. Keeps the request payload small. */
export interface HistoryTurn {
  speaker: Speaker;
  text: string;
  slideId: number;
}

/** Request body for POST /api/chat. */
export interface ChatRequest {
  kind: TurnKind;
  /** Slide currently on screen. */
  slideId: number;
  /** Conversation so far, oldest first. */
  history: HistoryTurn[];
  /** The trainee's question. Required when kind is 'answer'. */
  question?: string;
  /** Optional trainee name, used to make the session feel personal. */
  traineeName?: string;
  /** Slides the trainer has already taught, so it can refer back accurately. */
  coveredSlideIds?: number[];
  /** What the session has learned about the trainee so far. */
  learner?: LearnerProfile;
}

/** Server sent events emitted by POST /api/chat. */
export type ChatEvent =
  /** A chunk of the trainer's spoken reply. */
  | { type: 'text'; delta: string }
  /** The trainer wants a different slide on screen. */
  | { type: 'nav'; slideId: number; reason: string }
  /** The trainer has finished this turn. */
  | { type: 'done'; text: string; suggestedFollowUps: string[] }
  | { type: 'error'; message: string };

/** Response body for POST /api/deepgram/token. */
export interface DeepgramTokenResponse {
  /** Short-lived JWT for use from the browser. */
  token: string;
  /** Seconds until the token expires. */
  expiresIn: number;
  /**
   * WebSocket subprotocol scheme to pair with the token. Deepgram mirrors the
   * Authorization scheme here, so a JWT from /v1/auth/grant uses 'bearer'.
   */
  scheme: 'bearer' | 'token';
  /** Speech to text model the client should request. */
  model: string;
}

/** High level state of the session, which drives the whole interface. */
export type SessionPhase =
  /** Nothing started yet. */
  | 'idle'
  /** Asking for microphone permission and minting a token. */
  | 'connecting'
  /** The trainer is speaking. */
  | 'speaking'
  /** The trainer has finished and is waiting for the trainee. */
  | 'listening'
  /** A reply is being generated. */
  | 'thinking'
  /** Session complete. */
  | 'ended'
  | 'error';

/** Aggregate status of the microphone and transcription socket. */
export type MicState = 'off' | 'requesting' | 'live' | 'denied' | 'error';
