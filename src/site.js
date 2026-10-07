'use strict';
// Business details and page copy. Edit this file to change what the public site says.

module.exports = {
  brand: 'JE Fitness',
  monogram: 'JE',
  coach: 'Jackie',
  tagline: 'Personal Training',
  location: 'Bloemfontein, Free State',
  city: 'Bloemfontein',
  email: 'jackie.eloff1@icloud.com',
  replyTime: 'within 24 hours',

  about: {
    intro:
      "Coaching isn't about punishing yourself for a month and then quitting. It's about building something you can hold onto: " +
      'good technique, a plan that fits your week, and someone in your corner keeping you honest.',
    story: [
      'Every client gets a program written for their body, their goal and their schedule.',
      'You train on your own time, with the same structure every week: a diet plan, a training program ' +
        'and a check-in to keep things moving.',
    ],
    points: [
      'Programs built around your goal',
      'Diet plans you can actually stick to',
      'Weekly accountability check-ins',
      'Technique coached properly',
    ],
  },

  // Jackie's qualification, shown on the About page. The certificate image deliberately leaves out
  // the ID number printed on the original PDF: never publish the original.
  qualification: {
    title: 'Personal Training Certificate',
    awardedTo: 'Jackie Eloff',
    institution: 'Trifocus Fitness Academy',
    accreditation: 'CATHSSETA',
    accreditationFull: 'Culture, Arts, Tourism, Hospitality and Sport Sector Education and Training Authority',
    accreditationNo: '613/P/000193/2012',
    completed: '29 February 2024',
    completedYear: 2024,
    certificateNo: '110665',
    image: '/img/certificate.jpg',
    preview: '/img/certificate-preview.jpg',
    // What the subjects on the certificate qualify Jackie to do, in plain words.
    skills: [
      {
        icon: 'clipboard-list',
        title: 'Design your program',
        text: 'Trained to design exercise programs around your goal, your fitness level and the equipment you have.',
      },
      {
        icon: 'heart-pulse',
        title: 'Screen and test you first',
        text: 'Runs a health screening and fitness tests before you start, so your plan begins at a safe level and progress can be measured.',
      },
      {
        icon: 'person-standing',
        title: 'Coach proper technique',
        text: 'Studied anatomy, physiology and biomechanics: how your muscles and joints work, and how to load them safely.',
      },
      {
        icon: 'salad',
        title: 'Guide your nutrition',
        text: 'Nutrition and the principles of wellness are part of the qualification, so your diet plan is built to support your training.',
      },
      {
        icon: 'shield-check',
        title: 'Keep training safe',
        text: 'Trained in safety and risk management, and in keeping a training space and its equipment safe to use.',
      },
      {
        icon: 'users',
        title: 'Coach and motivate',
        text: 'Qualified to lead and instruct individuals and groups, and to keep you motivated and consistent.',
      },
      {
        icon: 'accessibility',
        title: 'Adapt for disabilities',
        text: 'Trained to include people with disabilities and to adapt training so it works for them.',
      },
      {
        icon: 'badge-check',
        title: 'Work professionally',
        text: 'Held to professional values and ethics, with clear communication from your first message to your last check-in.',
      },
    ],
    // Every subject listed on the certificate.
    subjects: [
      'Anatomy',
      'Physiology',
      'Biomechanics',
      'Concepts of fitness',
      'Nutrition',
      'Fitness testing',
      'Principles of wellness',
      'Operate professionally',
      'Conduct a screening procedure',
      'Motivate and encourage physical activity',
      'Lead and instruct individuals and groups',
      'Design exercise programmes',
      'Provide safety and risk management',
      'Maintain a sports and fitness environment and equipment',
      'Include persons with disabilities',
      'Apply entrepreneurship to a fitness business',
      'Examine social features in the workplace',
      'Plan and conduct a research project',
      'Operate a personal computer',
      'Function as a team',
      'Apply workplace communication skills',
      'Demonstrate professional values and ethics',
    ],
  },

  // What every online package includes.
  onlineIncludes: [
    {
      icon: 'salad',
      title: 'A diet plan built for you',
      text: "Meals built around what you actually eat and can buy locally, not a copy-paste bodybuilder menu.",
    },
    {
      icon: 'clipboard-list',
      title: 'Your own training program',
      text: 'Written around your goal, your experience and your equipment, whether that is a full gym or a garage setup.',
    },
    {
      icon: 'calendar-check',
      title: 'One check-in every week',
      text: 'Every week we review your progress, photos and numbers, and adjust the plan so it keeps working.',
    },
  ],

  process: [
    { title: 'Pick your program', text: 'Choose the online program that suits your goal, your budget and your schedule.' },
    { title: 'Pay securely', text: 'Checkout runs through PayFast, so you can pay by card, instant EFT or SnapScan.' },
    { title: 'Onboarding call', text: 'We talk through your goal, your injury history, your schedule and what you actually enjoy doing.' },
    { title: 'Train & check in', text: 'Your diet plan and training program are sent to you, then we check in and adjust as you progress.' },
  ],

  faqs: [
    {
      q: 'How do the online packages work?',
      a: 'After you pay, we have an onboarding call to map out your goal, your equipment and your schedule. You then get a diet plan and a training program built for you, and we check in once a week to review your progress and adjust.',
    },
    {
      q: 'Are you a qualified personal trainer?',
      a: 'Yes. I hold a Personal Training Certificate from Trifocus Fitness Academy, accredited by CATHSSETA, completed in February 2024. You can see the certificate and everything it covers on the About page.',
    },
    {
      q: 'Do I need a gym for online coaching?',
      a: "No. Your program is written around whatever you have access to: a full gym, a home setup, or just bodyweight and a pair of dumbbells. Tell me what you've got and I'll build around it.",
    },
    {
      q: 'Where are you based, and who can join?',
      a: "I'm based in Bloemfontein, and my programs are for clients in and around Bloemfontein. If you're elsewhere, email me anyway and I'll tell you honestly whether I can help.",
    },
    {
      q: 'How do I pay?',
      a: "Everything goes through PayFast, South Africa's payment gateway. You can pay by credit or debit card, instant EFT, SnapScan or Mobicred. Your card details are handled by PayFast and never stored on this site.",
    },
    {
      q: 'Can I cancel a monthly package?',
      a: "Yes. Monthly packages are rolling: you simply don't pay for the next month. The 12 Week Transformation and the 3-month Once-Off Program are paid up front for the full block.",
    },
    {
      q: 'What happens straight after I pay?',
      a: "You'll see a confirmation page with your reference number, and I'm notified straight away. I'll email you within 24 hours to set up your onboarding call.",
    },
  ],
};
