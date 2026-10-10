/**
 * Default copy for back-office-editable pages. Generated from the customer
 * app's current screens so the API and the app say the same thing on day one.
 * Served when no `app_content` row exists yet, and written by the seed
 * (only for keys that are missing, so admin edits are never overwritten).
 *
 * Legal pages (terms, privacy) are the app's existing draft text and need
 * legal review before launch.
 */

export const CONTENT_KEYS = [
  'app_info',
  'disclaimer',
  'terms_of_service',
  'privacy_policy',
  'credits',
  'future_features',
  'contact',
] as const;

export type ContentKey = (typeof CONTENT_KEYS)[number];

/** URL slugs used by the public routes → storage keys */
export const SLUG_TO_KEY: Record<string, ContentKey> = {
  'app-info': 'app_info',
  disclaimer: 'disclaimer',
  'terms-of-service': 'terms_of_service',
  'privacy-policy': 'privacy_policy',
  credits: 'credits',
  'future-features': 'future_features',
  contact: 'contact',
};

export interface ContentDefault {
  title: string;
  format: 'markdown' | 'html' | 'json';
  effectiveDate?: string;
  content: unknown;
}

export const CONTENT_DEFAULTS: Record<ContentKey, ContentDefault> = {
  app_info: {
    title: 'About FADA',
    format: 'json',
    content: {
      name: 'Fada',
      tagline: 'Find Any Drug Anywhere',
      about:
        'Fada (Find Any Drug Anywhere) is a Nigerian healthcare marketplace that connects patients with registered pharmacies. Our mission is to make medication accessible, transparent, and affordable for every Nigerian.',
      developer: {
        name: 'Devstrike Digital Limited',
        description:
          'Developed by Devstrike Digital Limited — a technology company based in Enugu, Nigeria, building digital solutions for African healthcare challenges.',
      },
      details: [
        {
          label: 'Platform',
          value: 'Android & iOS',
        },
        {
          label: 'Version',
          value: '1.0.0',
        },
        {
          label: 'Build',
          value: '1',
        },
        {
          label: 'Release Date',
          value: 'January 2025',
        },
        {
          label: 'Developer',
          value: 'Devstrike Digital Limited',
        },
        {
          label: 'Country',
          value: 'Nigeria',
        },
        {
          label: 'Language',
          value: 'English',
        },
        {
          label: 'Support Email',
          value: 'support@fada.ng',
        },
        {
          label: 'Website',
          value: 'www.fada.ng',
        },
      ],
    },
  },
  disclaimer: {
    title: 'Disclaimers',
    format: 'json',
    content: {
      sections: [
        {
          title: 'Not Medical Advice',
          body: 'The information provided on Fada is for informational purposes only and does not constitute medical advice, diagnosis, or treatment. Always seek the guidance of a qualified healthcare professional before starting, stopping, or changing any medication or treatment. Never disregard professional medical advice or delay seeking it because of information you read on Fada.',
        },
        {
          title: 'Pharmacy Independence',
          body: 'Pharmacies listed on Fada are independent businesses. Fada does not control, endorse, or guarantee the accuracy of pharmacy listings, drug prices, stock availability, or the quality of services provided by any pharmacy. We strongly recommend verifying drug details directly with the pharmacy before making a purchase decision.',
        },
        {
          title: 'Drug Prices',
          body: 'Drug prices displayed on Fada are indicative and subject to change without notice. Actual prices at the pharmacy may differ from what is displayed. Fada is not responsible for any price discrepancies between the app and the pharmacy. Always confirm the final price with the pharmacy at the point of pickup.',
        },
        {
          title: 'Drug Availability',
          body: 'While we strive to display accurate stock information, drug availability can change rapidly. A drug showing as "in stock" may not be available at the time of pickup. Fada does not guarantee that a reserved drug will be available. Pharmacies are responsible for fulfilling reservations based on their actual stock.',
        },
        {
          title: 'Regulatory Compliance',
          body: 'Fada facilitates connections between patients and pharmacies but does not participate in the dispensing of prescription medications. It is the responsibility of the pharmacy to verify prescriptions and comply with all applicable regulations under Nigerian pharmaceutical law, including the Pharmacists Council of Nigeria Act and NAFDAC guidelines.',
        },
        {
          title: 'Third-Party Links',
          body: 'Fada may contain links to third-party websites or services. We are not responsible for the content, privacy practices, or operations of any third-party sites. The inclusion of any link does not imply endorsement by Fada or Devstrike Digital Limited.',
        },
      ],
    },
  },
  terms_of_service: {
    title: 'Terms of Service',
    format: 'json',
    effectiveDate: '2025-01-01',
    content: {
      lastUpdated: '2025-01-01',
      sections: [
        {
          number: '1',
          title: 'Acceptance of Terms',
          body: 'By accessing or using the Fada application, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services. Fada reserves the right to modify these terms at any time, and continued use of the app following any changes constitutes your acceptance.',
        },
        {
          number: '2',
          title: 'Description of Service',
          body: 'Fada is a drug discovery and reservation platform that connects customers with registered pharmacies across Nigeria. Our platform allows users to search for medications, view pharmacy information, and make reservations for drug pickup. Fada does not dispense medications directly and acts solely as an intermediary platform.',
        },
        {
          number: '3',
          title: 'User Accounts',
          body: 'You must create an account to access certain features of Fada. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify Fada immediately of any unauthorized use of your account. Users must be at least 18 years old to create an account.',
        },
        {
          number: '4',
          title: 'Reservations & Pickup',
          body: 'Drug reservations made through Fada are valid for the period displayed at the time of reservation. Fada does not guarantee drug availability and reservations are subject to pharmacy stock. Users must present a valid reservation code (QR or alphanumeric) at the pharmacy for pickup. Fada is not responsible for any disputes between users and pharmacies.',
        },
        {
          number: '5',
          title: 'Prohibited Conduct',
          body: 'You agree not to: (a) use the platform for any unlawful purpose; (b) attempt to gain unauthorized access to any part of the platform; (c) submit false or misleading information; (d) interfere with the proper functioning of the platform; (e) use automated means to access the platform without authorization; or (f) misuse the reservation system including making fraudulent reservations.',
        },
        {
          number: '6',
          title: 'Intellectual Property',
          body: 'All content on the Fada platform, including text, graphics, logos, and software, is the property of Devstrike Digital Limited and is protected by applicable intellectual property laws. You may not copy, reproduce, distribute, or create derivative works from any content without our express written permission.',
        },
        {
          number: '7',
          title: 'Limitation of Liability',
          body: 'To the maximum extent permitted by law, Fada and Devstrike Digital Limited shall not be liable for any indirect, incidental, special, or consequential damages resulting from your use of or inability to use the platform. This includes but is not limited to damages for loss of profits, data, or other intangible losses, even if we have been advised of the possibility of such damages.',
        },
        {
          number: '8',
          title: 'Governing Law',
          body: 'These Terms of Service shall be governed by and construed in accordance with the laws of the Federal Republic of Nigeria. Any disputes arising from these terms or your use of Fada shall be subject to the exclusive jurisdiction of the courts of Enugu State, Nigeria.',
        },
        {
          number: '9',
          title: 'Contact Us',
          body: 'If you have any questions about these Terms of Service, please contact us at legal@fada.ng or through the Contact Support section in the Settings menu. Our team is available Monday to Friday, 9AM – 5PM WAT.',
        },
      ],
    },
  },
  privacy_policy: {
    title: 'Privacy Policy',
    format: 'json',
    effectiveDate: '2025-01-01',
    content: {
      lastUpdated: '2025-01-01',
      sections: [
        {
          number: '1',
          title: 'Information We Collect',
          body: 'We collect information you provide directly to us, such as your name, email address, phone number, date of birth, gender, and delivery address when you register for an account. We also collect information about your use of our services, including drug searches, reservations made, pharmacies visited, and in-app activity.',
        },
        {
          number: '2',
          title: 'How We Use Your Information',
          body: 'We use the information we collect to provide, maintain, and improve our services; process drug reservations; send you transactional communications; personalize your experience; detect and prevent fraud; comply with legal obligations; and send promotional communications (with your consent). We do not sell your personal information to third parties.',
        },
        {
          number: '3',
          title: 'Information Sharing',
          body: 'We share your information with registered pharmacies only as necessary to fulfill your reservation requests. We may share aggregated, anonymized data with partners for research and analytics. We may disclose your information if required by law, court order, or governmental authority, or to protect the rights and safety of our users and the public.',
        },
        {
          number: '4',
          title: 'Data Security',
          body: 'We implement industry-standard security measures to protect your personal information, including encryption of data in transit and at rest, secure authentication protocols, and regular security audits. However, no method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.',
        },
        {
          number: '5',
          title: 'Data Retention',
          body: 'We retain your personal information for as long as your account is active or as needed to provide our services. You may request deletion of your account and associated data at any time. We may retain certain information as required by law or for legitimate business purposes, such as fraud prevention.',
        },
        {
          number: '6',
          title: 'Your Rights',
          body: 'You have the right to access, correct, or delete your personal information. You may update your profile information at any time through the app. You have the right to opt out of marketing communications. You may request a copy of the personal data we hold about you by contacting our support team.',
        },
        {
          number: '7',
          title: 'Cookies & Tracking',
          body: 'Our mobile application uses local storage and analytics tools to improve user experience and understand how users interact with our platform. We do not use tracking cookies in the traditional web sense. Analytics data is anonymized and aggregated before use.',
        },
        {
          number: '8',
          title: "Children's Privacy",
          body: 'Fada is not intended for children under the age of 18. We do not knowingly collect personal information from children. If we become aware that we have collected personal data from a child without parental consent, we will delete that information immediately.',
        },
        {
          number: '9',
          title: 'Changes to This Policy',
          body: 'We may update this Privacy Policy from time to time. We will notify you of any material changes by sending a notification through the app or to the email address associated with your account. Your continued use of Fada after the effective date of the revised policy constitutes your acceptance of the changes.',
        },
        {
          number: '10',
          title: 'Contact Us',
          body: 'If you have questions or concerns about this Privacy Policy or our data practices, please contact our Data Protection Officer at privacy@fada.ng. You may also reach us through the Contact Support section in the Settings menu of the app.',
        },
      ],
    },
  },
  credits: {
    title: 'Credits',
    format: 'json',
    content: {
      coreTeam: [
        {
          name: 'Richard Uzor',
          role: 'Project Lead & Backend Architect',
        },
        {
          name: 'Devstrike Digital Limited',
          role: 'Product Design & Development',
        },
      ],
      technology: [
        {
          name: 'Flutter',
          description: 'Cross-platform mobile framework by Google',
        },
        {
          name: 'NestJS',
          description: 'Progressive Node.js backend framework',
        },
        {
          name: 'GoRouter',
          description: 'Declarative routing for Flutter',
        },
        {
          name: 'Bloc / Hydrated Bloc',
          description: 'State management & persistence',
        },
        {
          name: 'flutter_screenutil',
          description: 'Adaptive screen sizing',
        },
        {
          name: 'cached_network_image',
          description: 'Efficient image loading & caching',
        },
        {
          name: 'qr_flutter',
          description: 'QR code generation',
        },
        {
          name: 'confetti',
          description: 'Celebration animations',
        },
        {
          name: 'pinput',
          description: 'OTP input field widget',
        },
        {
          name: 'smooth_page_indicator',
          description: 'Page indicator animations',
        },
        {
          name: 'google_fonts (Inter)',
          description: 'Typography',
        },
        {
          name: 'GetIt & Injectable',
          description: 'Dependency injection',
        },
      ],
    },
  },
  future_features: {
    title: 'Future Features',
    format: 'json',
    content: {
      items: [
        {
          title: 'Smart Shopping List',
          status: 'In Development',
          description:
            'Build and manage persistent drug lists for your family. Automatically suggests alternatives when a drug is out of stock and estimates total costs across multiple pharmacies.',
          eta: 'Q2 2025',
        },
        {
          title: 'Price Comparison',
          status: 'Planned',
          description:
            'Compare drug prices across multiple pharmacies in your area. See the best deals at a glance and choose where to reserve based on price, distance, and pharmacy rating.',
          eta: 'Q3 2025',
        },
        {
          title: 'Drug Availability Alerts',
          status: 'Planned',
          description:
            'Set alerts for drugs that are currently out of stock. Get notified instantly when a pharmacy restocks a drug you need, so you can reserve before it runs out again.',
          eta: 'Q3 2025',
        },
        {
          title: 'Home Delivery',
          status: 'Coming Soon',
          description:
            'Partner with registered pharmacies and last-mile delivery services to bring your medications directly to your doorstep. Track your delivery in real time.',
          eta: 'Q4 2025',
        },
        {
          title: 'Prescription Management',
          status: 'Coming Soon',
          description:
            'Upload and store digital prescriptions securely. Share with pharmacies directly through the app and get reminders for prescription refills before they run out.',
          eta: 'Q1 2026',
        },
        {
          title: 'Pharmacist Chat',
          status: 'Research',
          description:
            'Connect with licensed pharmacists for quick questions about drug interactions, dosage, and side effects. Get expert guidance without leaving the app.',
          eta: 'TBD',
        },
      ],
    },
  },
  contact: {
    title: 'Contact Support',
    format: 'json',
    content: {
      email: 'support@fada.ng',
      phone: null,
      whatsapp: null,
      website: 'www.fada.ng',
      hours: 'Mon – Fri, 9AM – 5PM WAT',
      responseTime: 'We respond within 24 hours.',
    },
  },
};
