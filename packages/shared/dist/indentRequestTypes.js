"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDENT_CAP_REACHED_MESSAGE = exports.INDENT_REQUEST_TYPE_LABELS = exports.INDENT_REQUEST_TYPES = exports.INDENT_VALUE_CAP_INR = void 0;
exports.resolveMaterialUnitPrice = resolveMaterialUnitPrice;
exports.hasMaterialUnitPrice = hasMaterialUnitPrice;
exports.isMaterialOverBelowCap = isMaterialOverBelowCap;
exports.computeIndentLineTotal = computeIndentLineTotal;
exports.computeIndentRunningTotal = computeIndentRunningTotal;
exports.hideIndentPricingForRole = hideIndentPricingForRole;
exports.INDENT_VALUE_CAP_INR = 5000;
exports.INDENT_REQUEST_TYPES = ['BELOW_5000', 'ABOVE_5000'];
exports.INDENT_REQUEST_TYPE_LABELS = {
    BELOW_5000: 'Below ₹5,000',
    ABOVE_5000: 'Above ₹5,000',
};
function resolveMaterialUnitPrice(material) {
    const raw = material.unitPrice ?? material.referenceUnitPrice;
    const n = Number(raw);
    // Treat missing / non-positive catalogue rates as 0 so the ₹5,000 cap
    // still works; callers that need "price unavailable" should check hasMaterialUnitPrice.
    return Number.isFinite(n) && n > 0 ? n : 0;
}
/** True when catalogue/API returned a usable positive unit price. */
function hasMaterialUnitPrice(material) {
    return resolveMaterialUnitPrice(material) > 0;
}
/**
 * True when the material's own unit price already meets/exceeds the Below ₹5,000 cap.
 * Such materials must not be selectable on Below ₹5,000 indents.
 */
function isMaterialOverBelowCap(material) {
    return resolveMaterialUnitPrice(material) >= exports.INDENT_VALUE_CAP_INR;
}
function computeIndentLineTotal(quantity, unitPrice) {
    return Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
}
function computeIndentRunningTotal(lines) {
    const sum = lines.reduce((acc, line) => acc + computeIndentLineTotal(line.quantity, resolveMaterialUnitPrice(line.material)), 0);
    return Math.round((sum + Number.EPSILON) * 100) / 100;
}
/** Site / store must not see pricing on above-cap indents. */
function hideIndentPricingForRole(role, indentRequestType) {
    if (indentRequestType !== 'ABOVE_5000')
        return false;
    return role === 'SITE_INCHARGE' || role === 'STORE_INCHARGE';
}
exports.INDENT_CAP_REACHED_MESSAGE = 'The ₹5,000 limit for this indent has been reached. Please create an Above ₹5,000 indent request if additional materials are required.';
