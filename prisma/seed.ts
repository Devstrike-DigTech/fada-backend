import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  CONTENT_DEFAULTS,
  CONTENT_KEYS,
} from '../src/modules/content/content.defaults';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaPg } = require('@prisma/adapter-pg') as {
  PrismaPg: new (config: { connectionString: string }) => unknown;
};

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? '',
});
const prisma = new PrismaClient({ adapter: adapter as never });

const primaryCategories = [
  {
    name: 'Pain & Fever',
    slug: 'pain-fever',
    description: 'Analgesics, NSAIDs, opioids, antipyretics',
    sortOrder: 1,
  },
  {
    name: 'Infections',
    slug: 'infections',
    description:
      'Antibiotics, antifungals, antivirals, antimalarials, antiparasitics',
    sortOrder: 2,
  },
  {
    name: 'Cardiovascular',
    slug: 'cardiovascular',
    description:
      'Antihypertensives, diuretics, anticoagulants, lipid-lowering drugs',
    sortOrder: 3,
  },
  {
    name: 'Endocrine & Metabolic',
    slug: 'endocrine-metabolic',
    description: 'Antidiabetics, thyroid drugs, hormone therapy',
    sortOrder: 4,
  },
  {
    name: 'Respiratory',
    slug: 'respiratory',
    description: 'Asthma drugs, bronchodilators, antihistamines, cough syrups',
    sortOrder: 5,
  },
  {
    name: 'CNS & Mental Health',
    slug: 'cns-mental-health',
    description: 'Antidepressants, antipsychotics, antiepileptics, sedatives',
    sortOrder: 6,
  },
  {
    name: 'Gastrointestinal',
    slug: 'gastrointestinal',
    description: 'Antacids, anti-ulcer drugs, laxatives, antiemetics',
    sortOrder: 7,
  },
  {
    name: 'Dermatology',
    slug: 'dermatology',
    description: 'Creams, ointments, acne treatments, antifungal creams',
    sortOrder: 8,
  },
  {
    name: 'Pediatrics',
    slug: 'pediatrics',
    description: 'Child-specific formulations, syrups, drops',
    sortOrder: 9,
  },
  {
    name: "Women's Health",
    slug: 'womens-health',
    description: 'Contraceptives, fertility drugs, pregnancy supplements',
    sortOrder: 10,
  },
  {
    name: "Men's Health",
    slug: 'mens-health',
    description: 'Prostate medications, erectile dysfunction drugs',
    sortOrder: 11,
  },
  {
    name: 'Immunology & Vaccines',
    slug: 'immunology-vaccines',
    description: 'Vaccines, immunosuppressants',
    sortOrder: 12,
  },
  {
    name: 'Oncology',
    slug: 'oncology',
    description: 'Cancer drugs, chemotherapy agents',
    sortOrder: 13,
  },
  {
    name: 'Supplements & Vitamins',
    slug: 'supplements-vitamins',
    description: 'Multivitamins, minerals, herbal products',
    sortOrder: 14,
  },
  {
    name: 'Emergency & Critical Care',
    slug: 'emergency-critical-care',
    description: 'IV fluids, adrenaline, resuscitation drugs',
    sortOrder: 15,
  },
];

const secondaryCategories = [
  {
    name: 'Tablet',
    slug: 'tablet',
    description: 'Solid oral dosage form',
    sortOrder: 1,
  },
  {
    name: 'Capsule',
    slug: 'capsule',
    description: 'Gelatin-encased oral dosage form',
    sortOrder: 2,
  },
  {
    name: 'Syrup',
    slug: 'syrup',
    description: 'Liquid oral formulation',
    sortOrder: 3,
  },
  {
    name: 'Injection',
    slug: 'injection',
    description: 'Intramuscular or subcutaneous injection',
    sortOrder: 4,
  },
  {
    name: 'Infusion',
    slug: 'infusion',
    description: 'Intravenous infusion / drip',
    sortOrder: 5,
  },
  {
    name: 'Cream/Ointment',
    slug: 'cream-ointment',
    description: 'Topical cream or ointment',
    sortOrder: 6,
  },
  {
    name: 'Inhaler',
    slug: 'inhaler',
    description: 'Inhaled aerosol or powder',
    sortOrder: 7,
  },
  {
    name: 'Drops',
    slug: 'drops',
    description: 'Eye, ear, or nasal drops',
    sortOrder: 8,
  },
];

// ─── Subscription plans ───────────────────────────────────────────────────────
// Prices in ₦. Quarterly = 3 × monthly − 10 %, Annual = 12 × monthly − 25 %
// (renewal discounts from the product spec). Sokka is the free entry tier.
const quarterly = (monthly: number) => Math.round(monthly * 3 * 0.9);
const annual = (monthly: number) => Math.round(monthly * 12 * 0.75);

const subscriptionPlans = [
  {
    name: 'Sokka',
    slug: 'sokka',
    color: '#6b7280',
    sortOrder: 0,
    description: 'Free entry tier — get listed and start taking reservations.',
    monthlyPrice: 0,
    quarterlyPrice: null,
    annualPrice: null,
    inventorySlotLimit: 20,
    branchLimit: 1,
    hasAnalytics: false,
    hasAds: false,
    adDiscountPct: 0,
  },
  {
    name: 'Toph',
    slug: 'toph',
    color: '#f59e0b',
    sortOrder: 1,
    description: 'For small pharmacies growing their listed inventory.',
    monthlyPrice: 2500,
    quarterlyPrice: quarterly(2500),
    annualPrice: annual(2500),
    inventorySlotLimit: 50,
    branchLimit: 1,
    hasAnalytics: false,
    hasAds: false,
    adDiscountPct: 0,
  },
  {
    name: 'Katara',
    slug: 'katara',
    color: '#3b82f6',
    sortOrder: 2,
    description: 'More inventory slots and a second branch.',
    monthlyPrice: 5000,
    quarterlyPrice: quarterly(5000),
    annualPrice: annual(5000),
    inventorySlotLimit: 150,
    branchLimit: 2,
    hasAnalytics: false,
    hasAds: false,
    adDiscountPct: 0,
  },
  {
    name: 'Zuko',
    slug: 'zuko',
    color: '#ef4444',
    sortOrder: 3,
    description:
      'Store analytics, ad campaigns at a discount, up to three branches.',
    monthlyPrice: 7500,
    quarterlyPrice: quarterly(7500),
    annualPrice: annual(7500),
    inventorySlotLimit: 250,
    branchLimit: 3,
    hasAnalytics: true,
    hasAds: true,
    adDiscountPct: 30,
  },
  {
    name: 'Aang',
    slug: 'aang',
    color: '#8b5cf6',
    sortOrder: 4,
    description:
      'Everything in Zuko, 500 slots, promotion placement and the biggest ad discount.',
    monthlyPrice: 10000,
    quarterlyPrice: quarterly(10000),
    annualPrice: annual(10000),
    inventorySlotLimit: 500,
    branchLimit: 5,
    hasAnalytics: true,
    hasAds: true,
    adDiscountPct: 50,
  },
];

async function seedSubscriptionPlans() {
  console.log('Seeding subscription plans…');
  for (const plan of subscriptionPlans) {
    const { slug, ...rest } = plan;
    await prisma.subscriptionPlan.upsert({
      where: { slug },
      // providerPlanCodes is intentionally left untouched on re-seed
      update: { ...rest, isActive: true },
      create: { slug, ...rest, isActive: true },
    });
  }
  console.log(`Seeded ${subscriptionPlans.length} subscription plans.`);
}

// ─── Content pages ────────────────────────────────────────────────────────────
// Created only when missing so back-office edits are never overwritten.
// Good Cause projects and testimonials are NOT seeded: they must be real.
async function seedContentPages() {
  console.log('Seeding content pages…');
  let created = 0;
  for (const key of CONTENT_KEYS) {
    const def = CONTENT_DEFAULTS[key];
    const exists = await prisma.appContent.findUnique({ where: { key } });
    if (exists) continue;
    await prisma.appContent.create({
      data: {
        key,
        title: def.title,
        format: def.format,
        content:
          def.format === 'json'
            ? JSON.stringify(def.content)
            : String(def.content),
        effectiveDate: def.effectiveDate ? new Date(def.effectiveDate) : null,
      },
    });
    created++;
  }
  console.log(
    `Seeded ${created} content page(s); ${CONTENT_KEYS.length - created} already existed.`,
  );
}

async function main() {
  await seedSubscriptionPlans();
  await seedContentPages();

  console.log('Seeding drug categories…');

  for (const cat of primaryCategories) {
    await prisma.drugCategory.upsert({
      where: { slug: cat.slug },
      update: {
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        type: 'primary',
      },
      create: { ...cat, type: 'primary' },
    });
  }

  for (const cat of secondaryCategories) {
    await prisma.drugCategory.upsert({
      where: { slug: cat.slug },
      update: {
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        type: 'secondary',
      },
      create: { ...cat, type: 'secondary' },
    });
  }

  console.log(
    `Seeded ${primaryCategories.length} primary and ${secondaryCategories.length} secondary categories.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
