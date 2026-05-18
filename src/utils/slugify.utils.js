import slugifyLib from "slugify";

export const generateSlug = (text) =>
  slugifyLib(text, { lower: true, strict: true, trim: true });

export const generateUniqueSlug = async (text, Model, existingId = null) => {
  let slug = generateSlug(text);
  let count = 0;
  while (true) {
    const candidate = count === 0 ? slug : `${slug}-${count}`;
    const query = { slug: candidate };
    if (existingId) query._id = { $ne: existingId };
    const existing = await Model.findOne(query);
    if (!existing) return candidate;
    count++;
  }
};
