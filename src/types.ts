// src/types.ts
export interface TargetInfo {
  type: 'selection' | 'image' | 'link' | 'page';
  selectionText?: string;
  srcUrl?: string;
  pageUrl?: string;
  pageTitle?: string;
}

export interface ContextItem {
  type: 'selection' | 'image' | 'link';
  selectionText?: string;
  srcUrl?: string;
  pageUrl?: string;
  pageTitle?: string;
  timestamp: number;
}

export interface InterpretationData {
  interpretation: string;
  confidence: number;
  tone: string;
  contextSummary: string;
}

export interface StoredData {
  interpretation: InterpretationData;
  originalTarget: TargetInfo;
}

// --- New Type for Logging ---
export interface LogEntry {
  timestamp: string;          // ISO 8601 format
  extensionVersion: string;
  eventType: 
    | 'interpretStart'
    | 'interpretSuccess'
    | 'interpretFail'
    | 'addContext'
    | 'addContextFail'
    | 'clearContext'
    | 'screenshotFail';
  tabId: number;
  targetInfo?: TargetInfo;
  contextItem?: ContextItem;
  contextItemsCount?: number;
  interpretationData?: InterpretationData;
  apiUsage?: { inputTokens: number, outputTokens: number } | null;
  error?: string;
  trigger?: 'iconClick' | 'contextMenu';
}

// --- Message sent from content to background when the user wants to interpret. ---
export interface InterpretTargetMessage {
  type: "INTERPRET_TARGET";
  target: TargetInfo;
}

// --- Message sent from background to content when interpretation is starting. ---
export interface InterpretationNowLoadingMessage {
  type: "INTERPRETATION_NOW_LOADING";
}

// --- Message sent from background to content when the interpretation is ready. ---
export interface InterpretationReadyMessage {
  type: "INTERPRETATION_READY";
  interpretation: InterpretationData;
  triggerSource?: 'iconClick' | 'contextMenu';
}

// --- Message sent from background to content if the interpretation fails. ---
export interface InterpretationFailedMessage {
  type: "INTERPRETATION_FAILED";
  error?: string;
}