export interface UserDto {
    id: string;
    name: string;
    email: string;
    role: string;
    assignedProjectIds: string[];
    assignedSiteId?: string | null;
    assignedIndentCategoryIds?: string[];
    avatarColor: string;
    locale?: import('./locales').AppLocale;
    notificationPrefs?: NotificationPrefsDto;
    isSystemAdmin?: boolean;
}
export interface NotificationPrefsDto {
    inApp: boolean;
    emailDigest: boolean;
    sms: boolean;
}
export interface UpdateUserPreferencesDto {
    locale?: import('./locales').AppLocale;
    notificationPrefs?: Partial<NotificationPrefsDto>;
}
export interface CreateUserDto {
    name: string;
    email: string;
    password: string;
    role: string;
    assignedProjectIds?: string[];
    assignedSiteId?: string | null;
    avatarColor?: string;
}
export interface AuthTokensDto {
    accessToken: string;
    refreshToken: string;
}
export interface LoginResponseDto {
    user: UserDto;
    tokens: AuthTokensDto;
}
export interface ProjectDto {
    id: string;
    code: string;
    name: string;
    location: string;
    status: string;
    startDate: string;
    targetEndDate: string;
    budgetTotal: number;
    budgetSpent: number;
    healthScore: number;
    billingAddressId?: string | null;
    billingAddress?: string | null;
    hasProjectBillingAddress?: boolean;
}
export interface ExecutiveProjectSummaryDto {
    id: string;
    code: string;
    name: string;
    location: string;
    status: string;
    budgetTotal: number;
    budgetSpent: number;
    healthScore: number;
    deployPct?: number | null;
    openPoCount: number;
    openPoValue: number;
    openPrCount: number;
    pendingIndentCount: number;
}
export interface PaginationMetaDto {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}
export interface ExecutiveDashboardDto {
    projects: ExecutiveProjectSummaryDto[];
    pagination?: PaginationMetaDto;
    totals: {
        projectCount: number;
        openPoCount: number;
        openPrCount: number;
        pendingIndentCount: number;
    };
    registeredOfficeAddress: string;
}
export interface DashboardWidgetsDto {
    role: string;
    widgets: {
        pendingPo: number;
        pendingDeliveries: number;
        pendingMaterialReceipt: number;
        pendingApprovals: number;
        pendingProcurementDecisions?: number;
        pendingPoDecisions?: number;
        pendingBtDecisions?: number;
        pendingPoVerification?: number;
        pendingPurchaseRequests?: number;
    };
}
export interface ProcurementDecisionListItemDto {
    id: string;
    indentNumber: string;
    prNumber?: string | null;
    indentDate: string | null;
    status: string;
    projectCode?: string;
    projectName?: string;
    purpose?: string;
    priority?: 'HIGH' | 'MEDIUM' | 'NORMAL';
    estimatedValue: number;
    executiveProcurementMethod: 'PURCHASE_ORDER' | 'BRANCH_TRANSFER' | null;
}
export interface EnterpriseStockRowDto {
    projectId: string;
    projectCode: string;
    projectName: string;
    siteName: string;
    availableQty: number;
}
export interface ProcurementDecisionItemDto {
    id: string;
    materialId: string;
    materialName: string;
    unit: string;
    requestedQty: number;
    availableQty: number;
    requiredQty: number;
    enterpriseStock: EnterpriseStockRowDto[];
}
export interface ProcurementDecisionDto {
    id: string;
    indentNumber: string;
    indentDate: string | null;
    status: string;
    projectId?: string;
    projectCode?: string;
    projectName?: string;
    requestedBy?: string;
    purpose?: string;
    priority?: 'HIGH' | 'MEDIUM' | 'NORMAL';
    pmRemarks: string;
    estimatedValue: number;
    purchaseRequestId?: string | null;
    prNumber?: string | null;
    items: ProcurementDecisionItemDto[];
    executiveProcurementMethod: 'PURCHASE_ORDER' | 'BRANCH_TRANSFER' | null;
    executiveDecisionRemark: string;
    executiveDecidedBy: string | null;
    executiveDecidedAt: string | null;
    coordinatorProcurementMethod: 'PURCHASE_ORDER' | 'BRANCH_TRANSFER' | null;
    coordinatorProcurementRemark: string;
    canExecutiveDecide: boolean;
    canCoordinatorReview: boolean;
    redirect?: {
        type: string;
        path: string;
    };
}
export interface PoTimelineStageDto {
    stage: string;
    label: string;
    reachedAt: string | null;
    isCurrent: boolean;
    isComplete: boolean;
}
export interface PoTimelineDto {
    stages: PoTimelineStageDto[];
    currentStage: string;
}
export interface PoGrnLineSummaryDto {
    poLineId?: string;
    description?: string;
    orderedQty: number;
    cumulativeReceived: number;
    remainingQty: number;
    isComplete: boolean;
}
export interface GrnHoldQueueItemDto {
    id: string;
    grnNumber: string;
    status: string;
    approvalStage: string;
    requiresChairmanApproval: boolean;
    holdReasons: string[];
    invoiceNo?: string;
    invoiceValue?: number;
    receivedAt: string;
    poNumber: string;
    vendorName: string;
    projectName?: string;
    varianceDetails?: {
        lines: Array<Record<string, unknown>>;
    } | null;
}
export interface PoGrnListItemDto {
    id: string;
    grnNumber: string;
    status: string;
    approvalStage?: string;
    requiresChairmanApproval?: boolean;
    holdReasons?: string[];
    receiveType: string;
    isPartialGrn?: boolean;
    varianceDetails?: {
        lines: Array<Record<string, unknown>>;
    } | null;
    invoiceNo?: string;
    receivedAt: string;
    billNumber?: string;
    invoiceValue?: number;
    paidAmount?: number;
    outstandingAmount?: number;
    paymentStatus?: string;
    tallySyncStatus?: string;
}
export interface PoPaymentSummaryDto {
    totalInvoiced: number;
    totalPaid: number;
    totalOutstanding: number;
    paymentStatus: string;
    billCount: number;
}
export interface PoGrnsDto {
    fulfillmentStatus: 'open_partial' | 'closed_complete';
    lineSummary: PoGrnLineSummaryDto[];
    grns: PoGrnListItemDto[];
    paymentSummary?: PoPaymentSummaryDto;
}
export interface PaymentBillDto {
    id: string;
    billNumber: string;
    purchaseOrderId?: string;
    grnId?: string;
    vendorName: string;
    projectCode: string;
    projectName?: string;
    invoiceNumber: string;
    invoiceDate: string | null;
    invoiceValue: number;
    outstandingAmount: number;
    paidAmount: number;
    paymentStatus: string;
    invoiceStatus: string;
    tallySyncStatus: string;
    tallyVoucherId: string;
    dueDate: string | null;
    paidDate: string | null;
    agingDays: number;
    paymentRemark?: string;
}
export interface FinanceSummaryDto {
    pending: number;
    partial: number;
    overdue: number;
    paid: number;
    outstandingTotal: number;
    paidTotal: number;
    tallyPending: number;
    tallySynced: number;
    total: number;
}
export interface DeliveryAlertDto {
    id: string;
    poId?: string;
    poNumber?: string;
    expectedDeliveryDate?: string;
    alertCreatedAt?: string;
}
export interface ChairmanDashboardExtrasDto {
    suppliers: {
        totalCount: number;
        topVendors: Array<{
            id: string;
            name: string;
            code?: string;
            poCount: number;
            isMsme?: boolean;
        }>;
        pagination?: PaginationMetaDto;
    };
    stock: {
        skuCount: number;
        siteLedgerCount: number;
        shortages: number;
        totalOnHand: number;
        healthLabel: string;
    };
    analyticsPath: string;
    enterpriseSummary: {
        totalSpend: number;
        openPoCount: number;
        budgetDeployed: number;
        budgetCap: number;
        deployPct: number;
    };
}
export interface SiteDto {
    id: string;
    projectId: string;
    name: string;
    chainageLabel: string;
    project?: {
        id: string;
        code: string;
        name: string;
    };
}
export interface MaterialDto {
    id: string;
    code: string;
    name: string;
    description?: string;
    unit: string;
    grade?: string;
    category?: string;
    categoryId?: string;
    categoryRemarks?: string;
    hsnCode?: string;
    gstRate?: number;
    /** Latest approved purchase rate (reference only). */
    unitPrice?: number | null;
    /** Material Master reference rate when no PO history exists. */
    referenceUnitPrice?: number | null;
    /** Secondary line for indent/search pickers when names collide. */
    pickerSubtitle?: string;
}
export interface MaterialCategoryDto {
    id: string;
    name: string;
}
export interface ProjectGrnCounterDto {
    projectId?: string;
    purchaseOrderId?: string;
    nextNumber: number;
    grnNumber: string;
    lines?: PoGrnReceiptLineDto[];
}
export interface PoGrnReceiptLineDto {
    lineIndex: number;
    materialId?: string;
    description: string;
    unit: string;
    orderedQty: number;
    previouslyReceived: number;
    remainingQty: number;
    poRate: number;
}
export interface MaterialSearchResultDto {
    id: string;
    itemCode: string;
    description: string;
    name: string;
    hsnCode: string;
    gstRate: number;
    unit: string;
    category?: string;
    unitPrice?: number | null;
}
export interface IndentLineItemDto {
    id: string;
    materialId: string;
    quantityRequested: number;
    quantityAllocated?: number;
    quantityIssued?: number;
    /** Unit on this indent line (may differ from catalog default). */
    unit?: string;
    material?: MaterialDto;
    /** Stock comparison fields (server-computed). */
    requestedQty?: number;
    availableQty?: number;
    requiredQty?: number;
    /** Server-computed pricing (read-only). */
    unitPrice?: number | null;
    lineTotal?: number | null;
}
export interface IndentCategoryDto {
    id: string;
    name: string;
    isActive?: boolean;
    sortOrder?: number;
}
export interface ExecutiveAssignmentsDto {
    executives: Array<UserDto & {
        assignedIndentCategories?: IndentCategoryDto[];
    }>;
    categories: IndentCategoryDto[];
}
export interface CreateIndentDto {
    indentRequestType: 'BELOW_5000' | 'ABOVE_5000';
    purpose: string;
    requestedByName: string;
    indentCategoryId: string;
    items: Array<{
        materialId?: string;
        /** @deprecated Use materialId after POST /materials/site-request */
        customName?: string;
        unit?: string;
        quantityRequested: number;
    }>;
}
export interface CreateSiteMaterialDto {
    name: string;
    unit: string;
    category?: string;
    categoryRemarks?: string;
    description?: string;
}
export interface MaterialRequestDto {
    id: string;
    indentNumber: string;
    indentRequestType?: 'BELOW_5000' | 'ABOVE_5000';
    projectId: string;
    siteId: string;
    items: IndentLineItemDto[];
    itemCount: number;
    materialId?: string;
    quantityRequested?: number;
    quantityAllocated?: number;
    purpose?: string;
    requestedByName?: string;
    indentCategoryId?: string;
    indentCategory?: IndentCategoryDto;
    requiredByDate?: string | null;
    requestedByUserId: string;
    status: string;
    pendingWith?: string;
    createdAt: string;
    updatedAt: string;
    material?: MaterialDto;
    site?: SiteDto;
    project?: ProjectDto;
    requester?: {
        id: string;
        name: string;
    };
    estimatedValue?: number;
    escalatedToHo?: boolean;
    storeStockVerified?: boolean;
    origin?: 'SITE' | 'EXECUTIVE';
    rfqId?: string;
    rfqNumber?: string;
    canFullyIssue?: boolean;
    hasShortfall?: boolean;
    crossProjectStock?: Array<{
        materialId: string;
        materialName?: string;
        projects: Array<{
            projectId: string;
            projectCode: string;
            projectName: string;
            availableQty: number;
        }>;
    }>;
}
export interface PmDailyCapDto {
    dailyApprovedTotal: number;
    dailyCap: number;
    remaining: number;
}
export interface PmDashboardDto {
    pendingRequests: MaterialRequestDto[];
    approveQueue: MaterialRequestDto[];
    purchaseRequests: MaterialRequestDto[];
    notifications: NotificationDto[];
    dailyCap: PmDailyCapDto;
}
export type IssueReason = 'emergency' | 'already_approved' | 'urgent_work' | 'repeat_issue' | 'other';
export declare const ISSUE_REASON_LABELS: Record<IssueReason, string>;
export interface StatusHistoryDto {
    id: string;
    entityType: string;
    entityId: string;
    fromStatus: string | null;
    toStatus: string;
    actorUserId: string;
    actorName?: string;
    actorRole?: string;
    note?: string;
    timestamp: string;
}
export interface NotificationDto {
    id: string;
    userId: string;
    title: string;
    body: string;
    relatedEntityType: string;
    relatedEntityId: string;
    isRead: boolean;
    createdAt: string;
}
export interface StockLedgerDto {
    id: string;
    siteId: string;
    materialId: string;
    quantityOnHand: number;
    lowStockThreshold: number;
    lastMovementAt: string;
    material?: MaterialDto;
}
export interface StockMovementDto {
    id: string;
    siteId: string;
    materialId: string;
    materialRequestId?: string | null;
    quantityDelta: number;
    type: string;
    actorUserId: string;
    actorName?: string;
    timestamp: string;
    material?: MaterialDto;
}
export interface CreateMaterialRequestDto {
    materialId: string;
    quantityRequested: number;
    purpose: string;
    requiredByDate: string;
}
export interface AllocateMaterialRequestDto {
    quantityAllocated: number;
}
export interface ForwardMaterialRequestDto {
    reason: string;
}
export interface ApiErrorDto {
    statusCode: number;
    message: string | string[];
    error?: string;
}
export interface VendorGstDetailsDto {
    legalName?: string;
    tradeName?: string;
    status?: string;
    address?: string;
    registrationDate?: string;
    taxpayerType?: string;
    stateJurisdiction?: string;
    natureOfBusiness?: string[];
    provider?: string;
    gstin?: string;
    fetchedAt?: string;
    source?: 'MANUAL' | 'GST_PORTAL';
}
export interface VendorDto {
    id: string;
    name: string;
    code?: string;
    address: string;
    gstNumber: string;
    gstDetails?: VendorGstDetailsDto;
    gstLookupAvailable?: boolean;
    email: string;
    contactPerson: string;
    phone: string;
    contactInfo: string;
    category: string;
    suppliedCategories: string[];
    materialIds: string[];
    materials?: Array<{
        id: string;
        code: string;
        name: string;
        unit: string;
    }>;
    rating: number;
    isMsme?: boolean;
    msmeNumber?: string;
    msmeCertificateUrl?: string;
    panNumber?: string;
    bankName?: string;
    bankAccountNumber?: string;
    ifscCode?: string;
    authorizationStatus?: 'PENDING' | 'AUTHORIZED' | 'REJECTED';
}
export interface MsmeCertificateUploadDto {
    fileName: string;
    mimeType: string;
    dataBase64: string;
}
export interface CreateVendorDto {
    name: string;
    isMsme: boolean;
    code?: string;
    address?: string;
    gstNumber?: string;
    panNumber?: string;
    email?: string;
    contactPerson?: string;
    phone?: string;
    bankName?: string;
    bankAccountNumber?: string;
    ifscCode?: string;
    msmeNumber?: string;
    msmeCertificate?: MsmeCertificateUploadDto;
    category?: string;
    suppliedCategories?: string[];
    materialIds?: string[];
}
export interface UpdateVendorDto extends Partial<CreateVendorDto> {
}
export interface PurchaseRequestDto {
    id: string;
    prNumber: string;
    materialRequestId?: string;
    projectId: string;
    status: string;
    amountEstimate: number;
    createdAt: string;
    project?: {
        id: string;
        code: string;
        name: string;
    };
    materialRequest?: {
        id: string;
        indentNumber: string;
        status: string;
    };
    pmName?: string | null;
    materialsSummary?: string;
    totalValue?: number;
    requestDate?: string | null;
    priority?: 'HIGH' | 'MEDIUM' | 'NORMAL';
    pmRemarks?: string;
    requestedBy?: string | null;
    indentDate?: string | null;
    /** Live PO desk role when PR is at PO_CREATED (Coordinator / PM / Chairman). */
    pendingWith?: string | null;
    linkedPoId?: string | null;
    /** Active linked PO amount — drives approval routing (may be much lower than amountEstimate). */
    linkedPoAmount?: number | null;
    linkedPoRef?: string | null;
    executiveRecommendation?: 'PURCHASE_ORDER' | 'BRANCH_TRANSFER' | null;
    executiveRecommendationRemark?: string;
    executiveRecommendedAt?: string | null;
    canExecutiveDecide?: boolean;
    items?: Array<{
        id: string;
        materialId: string;
        materialName: string;
        unit: string;
        quantityRequested: number;
    }>;
}
export interface QuotationDto {
    id: string;
    rfqId: string;
    vendorId: string;
    vendor?: VendorDto;
    rate?: number;
    gstPercent?: number;
    finalCost?: number;
    amount: number;
    paymentTerms?: string;
    deliveryTerms?: string;
    terms: string;
    isL1?: boolean;
    submittedAt: string;
}
export interface QuotationComparisonVendorDto {
    id: string;
    rfqId: string;
    vendorId: string;
    vendorName: string;
    rate: number;
    gstPercent: number;
    subtotal?: number;
    gstAmount?: number;
    finalCost: number;
    paymentTerms: string;
    deliveryTerms: string;
    itemRates?: Array<{
        materialId: string;
        materialName: string;
        quantity: number;
        unit: string;
        rate: number;
        gstPercent: number;
        finalCost: number;
    }>;
    selectedMaterialIds?: string[];
    isL1: boolean;
    submittedAt?: string;
}
export interface QuotationComparisonDto {
    vendors: QuotationComparisonVendorDto[];
    itemComparisons?: Array<{
        materialId: string;
        materialName: string;
        quantity: number;
        unit: string;
        minOffer?: {
            vendorId: string;
            vendorName: string;
            rate: number;
            finalCost: number;
        } | null;
        maxOffer?: {
            vendorId: string;
            vendorName: string;
            rate: number;
            finalCost: number;
        } | null;
        offers?: Array<{
            vendorId: string;
            vendorName: string;
            rate: number;
            finalCost: number;
        }>;
    }>;
    l1VendorId?: string;
    l1QuotationId?: string;
}
export interface MaterialPurchaseHistoryDto {
    materialId?: string;
    materialName: string;
    minPurchaseRate: number | null;
    maxPurchaseRate: number | null;
    latestPurchaseRate?: number | null;
}
export interface RfqComparisonDto {
    rfqId: string;
    rfqNumber: string;
    status: string;
    quantity: number;
    comparison: QuotationComparisonDto;
    purchaseHistory: MaterialPurchaseHistoryDto[];
    selectedVendorId?: string;
    vendorSelectionReason?: string;
    whyWeChoseThisVendor?: string;
    items: Array<{
        materialId: string;
        name: string;
        code: string;
        quantity: number;
        unit: string;
    }>;
    indentNumber?: string;
    purchaseRequestId?: string;
}
export interface PoLineItemDto {
    id?: string;
    description: string;
    materialId?: string;
    itemCode?: string;
    hsnCode?: string;
    quantity: number;
    rate: number;
    gstPercent?: number;
    amount: number;
}
export type BillingAddressType = 'registered_office' | 'project_billing';
export type DeliveryAddressType = 'site' | 'workshop' | 'global' | 'other';
export interface PurchaseOrderDto {
    id: string;
    poNumber: string;
    displayPoNumber?: string;
    procurementRef?: string;
    financialYear?: string;
    poSeq?: number;
    draftRef?: string;
    purchaseRequestId: string;
    vendorId: string;
    quotationId?: string;
    amount: number;
    paymentTerms: string;
    additionalTerms?: string;
    billingAddress?: string;
    billingAddressType?: BillingAddressType;
    deliveryAddress?: string;
    deliveryAddressType?: DeliveryAddressType;
    deliveryAddressOtherText?: string;
    referenceNote?: string;
    vendorSelectionReason?: string;
    lineItems?: PoLineItemDto[];
    status: string;
    fulfillmentStatus?: 'open_partial' | 'closed_complete';
    expectedDeliveryDate?: string | null;
    approvalRoutingNote?: string;
    emailSentAt?: string | null;
    emailStatus?: 'pending' | 'queued' | 'sent' | 'failed' | 'skipped';
    approvedAsChairmanOverride?: boolean;
    overrideRemark?: string;
    finalApprovedAt?: string | null;
    createdAt: string;
    vendor?: VendorDto;
    purchaseRequest?: PurchaseRequestDto;
    quotation?: QuotationDto;
}
export interface AuditLogDto {
    id: string;
    actorUserId: string | null;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string | null;
    timestamp: string;
}
export interface RejectMaterialRequestDto {
    reason: string;
}
export interface VerifyPurchaseOrderDto {
    action: 'APPROVE' | 'RETURN' | 'CLARIFICATION';
    note?: string;
}
export interface PoApprovalHistoryEntryDto {
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string;
    timestamp: string;
    actorName: string;
    actorRole: string | null;
    isChairmanOverride: boolean;
    overrideRemark: string | null;
}
export interface PoApprovalHistoryDto {
    data: PoApprovalHistoryEntryDto[];
    meta: {
        approvedAsChairmanOverride: boolean;
        overrideRemark: string | null;
        finalApprovedAt: string | null;
        emailStatus: string;
        emailSentAt: string | null;
    };
}
export interface PoApproveOverrideDto {
    remark: string;
}
export interface CreatePurchaseOrderWizardDto {
    materialRequestId?: string;
    purchaseRequestId?: string;
    vendorId: string;
    paymentTerms: string;
    additionalTerms?: string;
}
export interface CreatePurchaseRequestDto {
    materialRequestId: string;
    amountEstimate: number;
}
export interface TodayActionDto {
    id: string;
    title: string;
    subtitle: string;
    href: string;
    priority: 'high' | 'medium' | 'low';
    count: number;
}
export interface ChairmanProjectBreakdownDto {
    projectId: string;
    code: string;
    name: string;
    healthScore: number;
    budgetTotal: number;
    budgetSpent: number;
    deployPct: number;
    purchaseOrders: number;
    approvedPoValue: number;
    pendingChairmanPos: number;
    indents: number;
    lateIndents: number;
}
export interface ChairmanKpiDto {
    budgetDeployed: number;
    budgetCap: number;
    budgetDeployPct: number;
    budgetChangePct: number;
    projectsRunning: number;
    approvalsPending: number;
    approvalsChangePct: number;
    shortages: number;
    shortagesChangePct: number;
    delayed: number;
    safetyIncidents: number;
    openIndents?: number;
    approvedPoCount?: number;
    approvedPoValue?: number;
    poPipeline?: {
        pmPending: number;
        coordinatorPending: number;
        chairmanPending: number;
        approved: number;
        rejected: number;
    };
    woPipeline?: {
        coordinatorPending: number;
        chairmanPending: number;
        inProgress: number;
    };
    approvalRules?: {
        pmMaxInr: number;
        coordinatorMaxInr: number;
        note: string;
    };
    projectBreakdown?: ChairmanProjectBreakdownDto[];
    projectPagination?: PaginationMetaDto;
    sparklines: {
        budget: number[];
        approvals: number[];
        shortages: number[];
    };
}
export interface UserAnalyticsRowDto {
    id: string;
    name: string;
    email: string;
    role: string;
    projects: Array<{
        id: string;
        code: string;
        name: string;
    }>;
    site?: {
        id: string;
        name: string;
        chainageLabel?: string;
    };
    materialIndents: number;
    safetyIncidents: number;
    poVerifications: number;
    chairmanApprovals: number;
    joinedAt: string;
}
export interface BudgetVsActualDto {
    projectId: string;
    code: string;
    name: string;
    budgetTotal: number;
    budgetSpent: number;
    deployPct: number;
    healthScore: number;
}
export interface SearchResultItemDto {
    id: string;
    label: string;
    sublabel: string;
    href: string;
}
export interface GlobalSearchDto {
    materials: SearchResultItemDto[];
    requests: SearchResultItemDto[];
    orders: SearchResultItemDto[];
    workOrders: SearchResultItemDto[];
    vendors: SearchResultItemDto[];
    projects: SearchResultItemDto[];
    grns: SearchResultItemDto[];
    branchTransfers: SearchResultItemDto[];
    employees: SearchResultItemDto[];
    sites: SearchResultItemDto[];
}
export interface MiscPurchaseDto {
    id: string;
    referenceNumber: string;
    expenseCategoryKey: string;
    expenseCategoryLabel: string;
    description: string;
    amount: number;
    projectId: string;
    projectCode: string;
    projectName: string;
    siteId?: string | null;
    siteName?: string;
    vendorName?: string;
    purchaseOrderId?: string | null;
    poNumber?: string;
    requiresPo: boolean;
    status: string;
    createdByUserId: string;
    createdByName?: string;
    approvedByUserId?: string | null;
    approvedByName?: string;
    approvedAt?: string | null;
    rejectionReason?: string;
    transactionDate?: string | null;
    note?: string;
    createdAt?: string | null;
}
export interface MonthlyTransactionReportDto {
    year: number;
    month: number;
    periodLabel: string;
    summary: {
        miscPurchaseTotal: number;
        poBillTotal: number;
        combinedTotal: number;
        miscTransactionCount: number;
        poBillCount: number;
    };
    miscByCategory: Array<{
        categoryKey: string;
        count: number;
        totalAmount: number;
        items: Array<{
            referenceNumber: string;
            description: string;
            amount: number;
            transactionDate: string | null;
        }>;
    }>;
    poBills: Array<{
        id: string;
        billNumber: string;
        vendorName: string;
        projectCode: string;
        invoiceValue: number;
        paymentStatus: string;
        createdAt: string | null;
    }>;
}
export interface MaterialCategoryReportDto {
    category: string;
    count: number;
    materials: Array<{
        id: string;
        code: string;
        name: string;
        unit: string;
    }>;
}
export interface MaterialAvailabilityDto {
    materialId: string;
    materialName: string;
    materialCode: string;
    unit: string;
    storeAvailableQty: number;
    companyAvailableQty: number;
    stores: Array<{
        siteId: string;
        siteName: string;
        projectId: string;
        projectCode: string;
        projectName: string;
        availableQty: number;
    }>;
    projectWise: Array<{
        projectId: string;
        projectCode: string;
        projectName: string;
        availableQty: number;
    }>;
}
export interface RfqListItemDto {
    id: string;
    rfqNumber: string;
    status: string;
    dueDate?: string | null;
    indentNumber?: string;
    purchaseRequestId?: string;
    createdAt: string;
}
export interface RfqDetailDto {
    id: string;
    rfqNumber: string;
    status: string;
    dueDate?: string | null;
    termsAndConditions: string[];
    indentNumber?: string;
    projectCode?: string;
    projectName?: string;
    items: Array<{
        materialId: string;
        name: string;
        code: string;
        quantity: number;
        unit: string;
    }>;
    quotations?: QuotationComparisonVendorDto[];
    comparison?: QuotationComparisonDto;
    purchaseHistory?: MaterialPurchaseHistoryDto[];
    selectedVendorId?: string;
    vendorSelectionReason?: string;
    whyWeChoseThisVendor?: string;
    vendors: Array<{
        id: string;
        name: string;
        email: string;
    }>;
    purchaseRequestId?: string;
    createdAt?: string;
}
export interface TallySyncStatusDto {
    pending: number;
    synced: number;
    failed: number;
    lastSyncAt: string | null;
    status: 'healthy' | 'syncing' | 'degraded';
}
export interface ExplorerProjectDto {
    id: string;
    code: string;
    name: string;
    status: string;
    storeNames: string[];
    storeCount: number;
    projectManagers: string[];
    projectManager: string;
    procurementStatus: string;
    pendingMaterialRequests: number;
    pendingPurchaseRequests: number;
    pendingPurchaseOrders: number;
    pendingGrns: number;
    pendingBranchTransfers: number;
    inventoryHealth: string;
    budgetStatus: string;
    budgetTotal: number;
    budgetSpent: number;
    deployPct: number;
    healthScore: number;
    siteCount: number;
}
export interface DelegationUserDto {
    id: string;
    name: string;
    role: string;
}
export interface ApprovalDelegationDto {
    id: string;
    scope: 'PO_FINAL' | 'MR_PM';
    validFrom: string;
    validTo: string;
    isActive: boolean;
    projectIds: string[];
    principal?: DelegationUserDto;
    delegate?: DelegationUserDto;
}
export interface DelegationStatusDto {
    canActAsChairman: boolean;
    canActAsPm: boolean;
    asDelegate: ApprovalDelegationDto[];
    asPrincipal: ApprovalDelegationDto[];
}
export interface DelegationUserOptionDto {
    id: string;
    name: string;
    email: string;
    role: string;
}
export interface VendorMetricsDto {
    poCount: number;
    approvedCount: number;
    rejectedCount: number;
    totalSpend: number;
    onTimeDeliveryPct: number;
    compositeRating: number | null;
}
export interface VendorReviewDto {
    id: string;
    deliveryScore: number;
    qualityScore: number;
    note: string;
    ratedByName: string;
    createdAt: string;
}
export interface VendorScorecardDto {
    vendor: VendorDto;
    metrics: VendorMetricsDto;
    recentOrders: Array<{
        id: string;
        poNumber: string;
        amount: number;
        status: string;
        createdAt: string;
    }>;
    reviews: VendorReviewDto[];
}
export interface WorkOrderMilestoneDto {
    id: string;
    name: string;
    status: string;
    order: number;
}
export interface WorkOrderMaterialIssueDto {
    id: string;
    materialId: string;
    materialName: string;
    materialUnit: string;
    quantity: number;
    issuedByUserId: string;
    issuedByName?: string;
    createdAt: string;
}
export interface WorkOrderCertificationDto {
    id: string;
    quantity: number;
    note: string;
    evidenceNote: string;
    certifiedByUserId: string;
    certifiedByName?: string;
    status: string;
    pmVerifiedByUserId?: string;
    pmNote?: string;
    createdAt: string;
}
export interface WorkOrderDto {
    id: string;
    woNumber: string;
    purchaseOrderId: string;
    projectId: string;
    siteId?: string;
    vendorId: string;
    scope: string;
    totalQuantity: number;
    quantityUnit: string;
    completedQuantity: number;
    progressPercent: number;
    contractValue: number;
    status: string;
    createdByUserId: string;
    createdAt: string;
    updatedAt: string;
    purchaseOrder?: PurchaseOrderDto;
    project?: {
        id: string;
        code: string;
        name: string;
    };
    site?: SiteDto;
    vendor?: VendorDto;
    milestones: WorkOrderMilestoneDto[];
    materialIssues: WorkOrderMaterialIssueDto[];
    certifications: WorkOrderCertificationDto[];
}
export interface CreateWorkOrderDto {
    purchaseOrderId: string;
    scope: string;
    totalQuantity: number;
    quantityUnit: string;
    siteId?: string;
}
export interface UpdateWorkOrderProgressDto {
    completedQuantity?: number;
    milestones?: Array<{
        id: string;
        status: string;
    }>;
}
export interface IssueWorkOrderMaterialDto {
    materialId: string;
    quantity: number;
}
export interface CertifyWorkOrderDto {
    quantity: number;
    note: string;
    evidenceNote?: string;
}
export interface BranchTransferItemDto {
    materialId?: string;
    materialName?: string;
    quantity: number;
    quantityReceived?: number;
}
export interface BranchTransferDto {
    id: string;
    transferNumber: string;
    status: string;
    fromProjectId?: string;
    toProjectId?: string;
    fromProject?: string;
    toProject?: string;
    fromProjectName?: string;
    toProjectName?: string;
    materialRequestId?: string;
    coordinatorDecision?: string | null;
    itemCount: number;
    items?: BranchTransferItemDto[];
    note?: string;
    rejectionNote?: string;
    requestedBy?: string;
    requestedByUserId?: string;
    pmApprovedBy?: string;
    pmApprovedAt?: string;
    coordinatorDecidedBy?: string;
    coordinatorDecidedAt?: string;
    transferredAt?: string;
    createdAt?: string;
    canPmApprove?: boolean;
    canPmReject?: boolean;
    canCoordinatorDecide?: boolean;
    canCoordinatorReject?: boolean;
    canExecutiveApprove?: boolean;
    canExecutiveReject?: boolean;
    canExecute?: boolean;
}
export interface CreateBranchTransferDto {
    fromProjectId: string;
    toProjectId?: string;
    items: Array<{
        materialId: string;
        quantity: number;
    }>;
    note?: string;
    materialRequestId?: string;
}
export interface CoordinatorDecideBranchTransferDto {
    decision: 'transfer' | 'raise_po_instead';
    note?: string;
    fromProjectId?: string;
    toProjectId?: string;
    items?: Array<{
        materialId: string;
        quantity: number;
    }>;
}
export interface IncidentDto {
    id: string;
    incidentNumber: string;
    projectId: string;
    siteId?: string | null;
    type: string;
    severity: string;
    title: string;
    description: string;
    status: string;
    reportedByUserId: string;
    reportedByName?: string;
    resolvedByUserId?: string | null;
    resolvedByName?: string;
    resolutionNote?: string;
    resolvedAt?: string | null;
    createdAt: string;
    project?: {
        id: string;
        code: string;
        name: string;
    };
    site?: {
        id: string;
        name: string;
        chainageLabel: string;
    };
}
export interface CreateIncidentDto {
    projectId: string;
    siteId?: string | null;
    type: string;
    severity?: string;
    title: string;
    description: string;
}
export interface CreateProjectDto {
    code: string;
    name: string;
    location: string;
    status?: string;
    budgetTotal?: number;
    startDate?: string;
    targetEndDate?: string;
}
export interface UpdateProjectDto {
    name?: string;
    location?: string;
    status?: string;
    budgetTotal?: number;
    healthScore?: number;
}
export interface CreateSiteDto {
    projectId: string;
    name: string;
    chainageLabel: string;
}
export interface MaterialStockDto {
    quantityOnHand: number;
    lowStockThreshold: number;
    isLowStock: boolean;
    hasLedger: boolean;
}
export interface MaterialCatalogItemDto extends MaterialDto {
    stock: MaterialStockDto;
}
export interface AddMaterialStockDto {
    siteId?: string;
    quantity: number;
    lowStockThreshold?: number;
    mode?: 'set' | 'add';
}
export interface UpdateMaterialDto {
    code?: string;
    name?: string;
    unit?: string;
    description?: string;
    grade?: string;
    category?: string;
    categoryId?: string;
    categoryRemarks?: string;
    hsnCode?: string;
    gstRate?: number;
}
export interface CreateMaterialDto {
    code: string;
    name: string;
    unit: string;
    description?: string;
    grade?: string;
    category?: string;
    categoryId?: string;
    categoryRemarks?: string;
    hsnCode?: string;
    gstRate?: number;
    siteId?: string;
    initialQuantity?: number;
    lowStockThreshold?: number;
}
export interface ExpenseCategoryApprovalDto {
    key: string;
    label: string;
    requiresPo: boolean;
    pmMaxInr: number;
    coordinatorMaxInr: number;
    description?: string;
}
export interface OrgSettingsDto {
    poPmMaxInr: number;
    poCoordinatorMaxInr: number;
    mrPmDailyMaxInr: number;
    timezone: string;
    expenseCategories: ExpenseCategoryApprovalDto[];
    approvalRoutingNote: string;
    updatedAt?: string;
}
export interface UpdateOrgSettingsDto {
    poPmMaxInr?: number;
    poCoordinatorMaxInr?: number;
    mrPmDailyMaxInr?: number;
    timezone?: string;
    expenseCategories?: ExpenseCategoryApprovalDto[];
}
export interface ApprovalLimitsDto {
    poPmMaxInr: number;
    poCoordinatorMaxInr: number;
    mrPmDailyMaxInr: number;
    approvalRoutingNote: string;
}
