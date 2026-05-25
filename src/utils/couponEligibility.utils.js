import Brand from "../models/brand.model.js";

// Given a coupon and a list of cart items with `product` populated (must include
// brand + category), return which items the coupon actually applies to and the
// subtotal of those items. Used by applyCoupon, validateCoupon, and order
// placement so the discount is consistently scoped to the eligible items only.
export const computeCouponEligibility = async (coupon, items) => {
  const hasRestrictions = Boolean(
    coupon.applicableBrands?.length ||
    coupon.applicableCategories?.length ||
    coupon.applicableSubcategories?.length
  );

  if (!hasRestrictions) {
    const applicableAmount = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
    return { hasRestrictions: false, applicableItems: items, applicableAmount };
  }

  let brandNames = [];
  if (coupon.applicableBrands?.length) {
    const brands = await Brand.find({ _id: { $in: coupon.applicableBrands } }).select("name");
    brandNames = brands.map((b) => (b.name || "").toLowerCase());
  }

  const catIds = (coupon.applicableCategories || []).map((id) => id.toString());
  const subIds = (coupon.applicableSubcategories || []).map((id) => id.toString());

  const applicableItems = items.filter((item) => {
    const product = item.product;
    if (!product) return false;
    if (brandNames.length) {
      if (!brandNames.includes(String(product.brand || "").toLowerCase())) return false;
    }
    const productCatId = product.category?._id?.toString() || product.category?.toString();
    if (catIds.length && !catIds.includes(productCatId)) return false;
    if (subIds.length && !subIds.includes(productCatId)) return false;
    return true;
  });

  const applicableAmount = applicableItems.reduce(
    (sum, it) => sum + it.price * it.quantity,
    0
  );

  return { hasRestrictions: true, applicableItems, applicableAmount };
};
