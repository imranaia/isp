// Starting text and pictures for the landing page. The super admin can change all of it
// from the dashboard ("Edit Landing Page"); saved changes are stored in the database.

module.exports = {
  brand: {
    party: "Allied Peoples Movement",
    partyShort: "APM",
    logo: "/img/apm-logo.jpg",
  },
  hero: {
    brandLine: "HASKE 27",
    eyebrow: "Adamawa State 2027 · Governorship",
    titleTop: "Abdurrahman",
    titleBottom: "Bashir Haske",
    subtitle: "APM candidate for Governor, Adamawa State",
    tagline: "Building a state where governance works for the people.",
    cta: "Get Started",
    image: "/img/haske-1.jpg",
  },
  about: {
    heading: "A builder, not a bystander.",
    kicker: "About Haske",
    body:
      "Abdurrahman Bashir Haske is a businessman and philanthropist from Adamawa State. Through the AB Haske Foundation he has supported education, youth and women entrepreneurship, and families in need across the state. His 48-ton-per-day rice processing mill backs local farmers and creates jobs at home.",
    body2:
      "In 2026 he joined the Allied Peoples Movement as its governorship candidate, calling the move \"a convergence of principle and purpose.\" His campaign is built on accountable leadership, youth participation and development that reaches all 21 local government areas.",
    image: "/img/haske-2.jpg",
    facts: [
      { value: "21", label: "Local governments, one plan" },
      { value: "7", label: "Pillars of the ADAMAWA agenda" },
      { value: "2027", label: "The year Adamawa decides" },
    ],
  },
  agenda: {
    kicker: "Aims & Objectives",
    heading: "The ADAMAWA First Agenda",
    intro: "Seven pillars. One for every letter of the state we love.",
    pillars: [
      { letter: "A", title: "Agriculture & Agro-Industry", body: "Make farming a real source of wealth through mechanisation, value chains, agro-processing and wider markets, turning Adamawa into a leading agro-industrial hub." },
      { letter: "D", title: "Development & Infrastructure", body: "Invest in roads, water supply, energy, digital connectivity and environmental protection that every community can feel." },
      { letter: "A", title: "Access to Social Development", body: "Quality education and affordable healthcare, so that no community is left out because of distance or cost." },
      { letter: "M", title: "Meaningful Youth Inclusion", body: "Back young people with entrepreneurship support, innovation, skills and real jobs." },
      { letter: "A", title: "Accountable & Inclusive Governance", body: "Transparency, accountability and fair sharing of resources. Public money managed in the open." },
      { letter: "W", title: "Wealth Creation & Empowerment", body: "Attract investment, create jobs and give citizens skills and access to finance in all 21 LGAs." },
      { letter: "A", title: "Assurance of Security", body: "Safe farms, safe markets and peaceful communities, so people can work and live without fear." },
    ],
  },
  deputy: {
    kicker: "Running Mate",
    teamHeading: "A new direction for Adamawa 2027",
    teamImage: "/img/together.jpg",
    image: "/img/deputy.jpg",
    name: "Engr. Mrs. Safriel Judson Glah",
    role: "Deputy Governorship Candidate",
    body: "A retired General Manager at NNPC Limited and Fellow of the Nigerian Society of Engineers, with more than 34 years in engineering management, environmental policy and sustainability.",
    quote: "I am ready to listen, ready to work, and ready to serve.",
  },
  quote: {
    text: "I accept this mandate with humility and an unwavering determination to justify this confidence.",
    by: "Abdurrahman Bashir Haske",
  },
  gallery: {
    kicker: "Gallery",
    heading: "On the move across Adamawa",
    images: ["/img/haske-1.jpg", "/img/together.jpg", "/img/haske-2.jpg", "/img/deputy.jpg", "/img/haske-3.jpg"],
  },
  join: {
    heading: "Join the movement.",
    body: "Agents across every local government, ward and polling unit are building this campaign from the ground up. Sign in to get started.",
    cta: "Get Started",
  },
  footer: {
    text: "Haske 2027 · Allied Peoples Movement (APM) · Adamawa State",
  },
};
