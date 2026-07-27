/**
 * One-level-ahead indent edit policy:
 * A role may modify an indent only while it is pending at the *next* desk.
 * Once it moves further, that role can no longer edit.
 *
 * Site   → edit only while pending at Store   (PENDING_STORE)
 * Store  → edit only while pending at PM      (FORWARDED_TO_PM)
 * PM     → edit only while pending at Executive / HO
 * Executive → edit only while pending at Coordinator
 * Coordinator → edit only while pending at Chairman (COORDINATOR_VERIFIED)
 */
export declare const INDENT_EDIT_STATUSES_BY_ROLE: Record<string, readonly string[]>;
export declare function canEditIndentOneLevelAhead(role: string | null | undefined, status: string | null | undefined): boolean;
export declare function indentEditLockedMessage(role: string, status: string): string;
