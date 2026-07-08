/** Statuses where Head Office owns procurement — site/store see a single friendly label. */
export declare const HEAD_OFFICE_PIPELINE_STATUSES: Set<string>;
export declare function isHeadOfficePipelineStatus(status: string): boolean;
export declare function getIndentStatusLabel(status: string, viewerRole?: string): string;
