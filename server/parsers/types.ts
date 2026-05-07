export type ParseResult = {
  title?: string;
  beginDate?: string; // YYYY-MM-DD
  endDate?: string;
  montageStart?: string;
  montageEnd?: string;
  dismantleStart?: string;
  dismantleEnd?: string;
  venue?: string;
  /** 1.0 = full event+montage+dismantle dates, 0.7 = only event begin/end,
   *  0.3 = generic regex fallback. 0 = nothing useful. */
  confidence: number;
  /** Short human-readable notes, used to feed parse log lines. */
  notes: string[];
  /** Source URL the parser was given (echoed for audit). */
  url: string;
  /** Hostname we dispatched on. */
  host: string;
  /** Parser name we dispatched to. */
  parser: string;
};

export type Fetcher = (url: string) => Promise<{ html: string; finalUrl: string }>;
