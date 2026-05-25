import Brand from "../models/brand.model.js";
import Category from "../models/category.model.js";

/**
 * Given a coupon and a list of cart items with `product` populated (must include
 * brand + category), return which items the coupon actually applies to and the
 * subtotal of those items. Used by applyCoupon, validateCoupon, and order
 * placement so the discount is consistently scoped to the eligible items only.
 *
 * Eligibility semantics for category restrictions — a product matches if ANY:
 *   1. product.category is in applicableSubcategories         (exact sub-cat match)
 *   2. product.category is in applicableCategories            (top-level direct match)
 *   3. product.category.parent is in applicableCategories     (product sits under that top-level branch)
 *
 * If BOTH applicableCategories and applicableSubcategories are set, the product
 * passes if EITHER list matches — they're an OR, not an AND. (The old code
 * required both, which is impossible since a product is in only one category.)
 */
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

  const catIds = new Set((coupon.applicableCategories    || []).map((id) => id.toString()));
  const subIds = new Set((coupon.applicableSubcategories || []).map((id) => id.toString()));
  const categoryRestricted = catIds.size > 0 || subIds.size > 0;

  // Resolve product-category parent ids in one query so we can check whether a
  // product's sub-category sits under one of the coupon's top-level categories.
  let parentMap = {};
  if (categoryRestricted && catIds.size > 0) {
    const productCatIds = items
      .map((it) => it.product?.category?._id?.toString() || it.product?.category?.toString())
      .filter(Boolean);
    if (productCatIds.length) {
      const cats = await Category.find({ _id: { $in: productCatIds } }).select("parent");
      for (const c of cats) {
        parentMap[c._id.toString()] = c.parent ? c.parent.toString() : null;
      }
    }
  }

  const applicableItems = items.filter((item) => {
    const product = item.product;
    if (!product) return false;

    if (brandNames.length) {
      if (!brandNames.includes(String(product.brand || "").toLowerCase())) return false;
    }

    if (categoryRestricted) {
      const productCatId = product.category?._id?.toString() || product.category?.toString();
      if (!productCatId) return false;
      const parentId = parentMap[productCatId] || null;
      const matchesSub      = subIds.has(productCatId);
      const matchesCatDirect = catIds.has(productCatId);
      const matchesCatViaParent = parentId && catIds.has(parentId);
      if (!(matchesSub || matchesCatDirect || matchesCatViaParent)) return false;
    }

    return true;
  });

  const applicableAmount = applicableItems.reduce(
    (sum, it) => sum + it.price * it.quantity,
    0
  );

  return { hasRestrictions: true, applicableItems, applicableAmount };
};
