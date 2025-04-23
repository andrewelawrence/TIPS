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