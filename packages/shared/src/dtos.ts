export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  assignedProjectIds: string[];
  assignedSiteId?: string | null;
  avatarColor: string;
  locale?: import('./locales').AppLocale;
  notificationPrefs?: NotificationPrefsDto;
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
}

export interface SiteDto {
  id: string;
  projectId: string;
  name: string;
  chainageLabel: string;
  project?: { id: string; code: string; name: string };
}

export interface MaterialDto {
  id: string;
  code: string;
  name: string;
  description?: string;
  unit: string;
  grade?: string;
  category?: string;
  hsnCode?: string;
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
}

export interface CreateIndentDto {
  items: Array<{
    materialId?: string;
    /** Free-text product when not in catalog — created on submit. */
    customName?: string;
    unit?: string;
    quantityRequested: number;
  }>;
}

export interface MaterialRequestDto {
  id: string;
  indentNumber: string;
  projectId: string;
  siteId: string;
  items: IndentLineItemDto[];
  itemCount: number;
  materialId?: string;
  quantityRequested?: number;
  quantityAllocated?: number;
  purpose?: string;
  requiredByDate?: string | null;
  requestedByUserId: string;
  status: string;
  pendingWith?: string;
  createdAt: string;
  updatedAt: string;
  material?: MaterialDto;
  site?: SiteDto;
  project?: ProjectDto;
  requester?: { id: string; name: string };
}

export interface StatusHistoryDto {
  id: string;
  entityType: string;
  entityId: string;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: string;
  actorName?: string;
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

export interface VendorDto {
  id: string;
  name: string;
  code?: string;
  address: string;
  gstNumber: string;
  email: string;
  contactPerson: string;
  phone: string;
  contactInfo: string;
  category: string;
  suppliedCategories: string[];
  materialIds: string[];
  materials?: Array<{ id: string; code: string; name: string; unit: string }>;
  rating: number;
}

export interface CreateVendorDto {
  name: string;
  code?: string;
  address?: string;
  gstNumber?: string;
  email?: string;
  contactPerson?: string;
  phone?: string;
  category?: string;
  suppliedCategories?: string[];
  materialIds?: string[];
}

export interface UpdateVendorDto extends Partial<CreateVendorDto> {}

export interface PurchaseRequestDto {
  id: string;
  prNumber: string;
  materialRequestId?: string;
  projectId: string;
  status: string;
  amountEstimate: number;
  createdAt: string;
  project?: { id: string; code: string; name: string };
  materialRequest?: { id: string; indentNumber: string; status: string };
}

export interface QuotationDto {
  id: string;
  rfqId: string;
  vendorId: string;
  vendor?: VendorDto;
  amount: number;
  terms: string;
  submittedAt: string;
}

export interface PoLineItemDto {
  id?: string;
  description: string;
  materialId?: string;
  hsnCode?: string;
  quantity: number;
  rate: number;
  gstPercent?: number;
  amount: number;
}

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
  billingAddress?: string;
  deliveryAddress?: string;
  referenceNote?: string;
  lineItems?: PoLineItemDto[];
  status: string;
  approvalRoutingNote?: string;
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

export interface CreatePurchaseOrderWizardDto {
  materialRequestId?: string;
  purchaseRequestId?: string;
  vendorId: string;
  paymentTerms: string;
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
  projects: Array<{ id: string; code: string; name: string }>;
  site?: { id: string; name: string; chainageLabel?: string };
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
  project?: { id: string; code: string; name: string };
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
  milestones?: Array<{ id: string; status: string }>;
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
  project?: { id: string; code: string; name: string };
  site?: { id: string; name: string; chainageLabel: string };
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
  hsnCode?: string;
}

export interface CreateMaterialDto {
  code: string;
  name: string;
  unit: string;
  description?: string;
  grade?: string;
  category?: string;
  hsnCode?: string;
  siteId?: string;
  initialQuantity?: number;
  lowStockThreshold?: number;
}
