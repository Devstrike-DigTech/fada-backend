import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaPg } = require('@prisma/adapter-pg') as {
  PrismaPg: new (config: { connectionString: string }) => unknown;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter: adapter as never });

const primaryCategories = [
  { name: 'Pain & Fever',                slug: 'pain-fever',             description: 'Analgesics, NSAIDs, opioids, antipyretics',               sortOrder: 1 },
  { name: 'Infections',                  slug: 'infections',             description: 'Antibiotics, antifungals, antivirals, antimalarials, antiparasitics', sortOrder: 2 },
  { name: 'Cardiovascular',              slug: 'cardiovascular',         description: 'Antihypertensives, diuretics, anticoagulants, lipid-lowering drugs', sortOrder: 3 },
  { name: 'Endocrine & Metabolic',       slug: 'endocrine-metabolic',    description: 'Antidiabetics, thyroid drugs, hormone therapy',            sortOrder: 4 },
  { name: 'Respiratory',                 slug: 'respiratory',            description: 'Asthma drugs, bronchodilators, antihistamines, cough syrups', sortOrder: 5 },
  { name: 'CNS & Mental Health',         slug: 'cns-mental-health',      description: 'Antidepressants, antipsychotics, antiepileptics, sedatives', sortOrder: 6 },
  { name: 'Gastrointestinal',            slug: 'gastrointestinal',       description: 'Antacids, anti-ulcer drugs, laxatives, antiemetics',       sortOrder: 7 },
  { name: 'Dermatology',                 slug: 'dermatology',            description: 'Creams, ointments, acne treatments, antifungal creams',    sortOrder: 8 },
  { name: 'Pediatrics',                  slug: 'pediatrics',             description: 'Child-specific formulations, syrups, drops',              sortOrder: 9 },
  { name: "Women's Health",              slug: 'womens-health',          description: 'Contraceptives, fertility drugs, pregnancy supplements',   sortOrder: 10 },
  { name: "Men's Health",                slug: 'mens-health',            description: 'Prostate medications, erectile dysfunction drugs',         sortOrder: 11 },
  { name: 'Immunology & Vaccines',       slug: 'immunology-vaccines',    description: 'Vaccines, immunosuppressants',                            sortOrder: 12 },
  { name: 'Oncology',                    slug: 'oncology',               description: 'Cancer drugs, chemotherapy agents',                       sortOrder: 13 },
  { name: 'Supplements & Vitamins',      slug: 'supplements-vitamins',   description: 'Multivitamins, minerals, herbal products',                sortOrder: 14 },
  { name: 'Emergency & Critical Care',   slug: 'emergency-critical-care', description: 'IV fluids, adrenaline, resuscitation drugs',             sortOrder: 15 },
];

const secondaryCategories = [
  { name: 'Tablet',         slug: 'tablet',         description: 'Solid oral dosage form',                   sortOrder: 1 },
  { name: 'Capsule',        slug: 'capsule',        description: 'Gelatin-encased oral dosage form',         sortOrder: 2 },
  { name: 'Syrup',          slug: 'syrup',          description: 'Liquid oral formulation',                  sortOrder: 3 },
  { name: 'Injection',      slug: 'injection',      description: 'Intramuscular or subcutaneous injection',  sortOrder: 4 },
  { name: 'Infusion',       slug: 'infusion',       description: 'Intravenous infusion / drip',              sortOrder: 5 },
  { name: 'Cream/Ointment', slug: 'cream-ointment', description: 'Topical cream or ointment',               sortOrder: 6 },
  { name: 'Inhaler',        slug: 'inhaler',        description: 'Inhaled aerosol or powder',                sortOrder: 7 },
  { name: 'Drops',          slug: 'drops',          description: 'Eye, ear, or nasal drops',                 sortOrder: 8 },
];

async function main() {
  console.log('Seeding drug categories…');

  for (const cat of primaryCategories) {
    await prisma.drugCategory.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, description: cat.description, sortOrder: cat.sortOrder, type: 'primary' },
      create: { ...cat, type: 'primary' },
    });
  }

  for (const cat of secondaryCategories) {
    await prisma.drugCategory.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, description: cat.description, sortOrder: cat.sortOrder, type: 'secondary' },
      create: { ...cat, type: 'secondary' },
    });
  }

  console.log(`Seeded ${primaryCategories.length} primary and ${secondaryCategories.length} secondary categories.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
