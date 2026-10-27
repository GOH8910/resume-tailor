import type { ResumeDocument } from "./document";

export const exampleDocument: ResumeDocument = {
  profile: {
    name: "Alex Example",
    email: "alex@example.com",
    phone: "+44 7700 900000",
    linkedin: "https://linkedin.com/in/alex-example",
    github: "https://github.com/alex-example",
  },
  summary: "Software engineer who builds backend services & developer tools.",
  education: [
    {
      title: "Example University",
      org: "BSc Computer Science",
      location: "London, UK",
      start: "Sep 2020",
      end: "Jun 2024",
      bullets: ["Modules: Distributed Systems, Databases, Machine Learning."],
    },
  ],
  experience: [
    {
      title: "Software Engineer Intern",
      org: "Acme Corp",
      location: "London, UK",
      start: "Jul 2024",
      end: "Jan 2025",
      bullets: [
        "Built a Go service that ingests 2M events/day from Kafka into PostgreSQL.",
        "Cut p95 API latency from 800ms to 120ms by adding Redis caching and fixing N+1 queries.",
      ],
    },
  ],
  projects: [
    {
      title: "Trail Planner",
      start: "Jan 2024",
      end: "Present",
      link: "https://github.com/alex-example/trail-planner",
      bullets: ["Built a Next.js app with 15 API endpoints; ~90% of requests served from cache."],
    },
  ],
  skills: [
    { id: "s_lang", name: "Programming", items: ["TypeScript", "Python", "C++"] },
    { id: "s_infra", name: "Systems & Infrastructure", items: ["Linux", "Docker"] },
  ],
};
