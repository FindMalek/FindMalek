import type { Client, OpenSourceProject } from "@/types"

export const PAGES = {
  HOME: {
    path: "/",
    label: "FindMalek.",
    name: "Home",
    text: "Learn more about me",
  },
  ABOUT: {
    path: "/about",
    label: "About Me.",
    name: "About",
    text: "Learn more about me",
  },
  WORK: {
    path: "/work",
    label: "Work.",
    name: "Work",
    text: "Have a look at my work",
  },
  PROJECTS: {
    path: "/projects",
    label: "Projects.",
    name: "Projects",
    text: "Check out my projects",
  },
  STACK: {
    path: "/stack",
    label: "Stack.",
    name: "Stack",
    text: "Explore my tech stack",
  },
  CONTACT: {
    path: "/contact",
    label: "Contact Me.",
    name: "Contact",
    text: "Get in touch with me",
  },
  NOT_FOUND: {
    path: "*",
    label: "404 Not Found.",
    name: "404",
    text: "Return to home",
  },
} as const

export const NAV_ITEMS = {
  ABOUT: PAGES.ABOUT,
  WORK: PAGES.WORK,
  PROJECTS: PAGES.PROJECTS,
  STACK: PAGES.STACK,
  CONTACT: PAGES.CONTACT,
} as const

export type PagePath = (typeof PAGES)[keyof typeof PAGES]["path"]
export type PageLabel = (typeof PAGES)[keyof typeof PAGES]["label"]

export const BOOKS = [
  {
    id: "1",
    link: "https://www.goodreads.com/book/show/40121378-atomic-habits",
    image: "/books/atomic-habit.jpg",
    title: "Atomic Habits",
    author: "James Clear",
  },
  {
    id: "2",
    link: "https://www.goodreads.com/book/show/1303.The_48_Laws_of_Power",
    image: "/books/the-48-laws-of-power.jpg",
    title: "The 48 Laws of Power",
    author: "Robert Greene",
  },
  {
    id: "3",
    link: "https://www.goodreads.com/book/show/118700.The_Brothers_Karamazov",
    image: "/books/the-brothers-karamazov.jpg",
    title: "The Brothers Karamazov",
    author: "Fyodor Dostoevsky",
  },
]

export const CLIENTS: Client[] = [
  {
    name: "Real Reach",
    logo: "/clients/real-reach.png",
  },
  {
    name: "OpenStatus",
    logo: "/clients/open-status.png",
    href: "https://www.openstatus.dev",
  },
  {
    name: "Ultrabeam",
    logo: "/clients/ultabeam.png",
    href: "https://www.ultrabeam.app",
  },
  {
    name: "Lead Insight",
    logo: "/clients/leadinsight.svg",
    href: "https://lead-insight.vercel.app",
  },
  {
    name: "Waste Not",
    href: "https://waste-not.findmalek.com/",
  },
  {
    name: "Thryve",
    logo: "/clients/thryve.png",
  },
  {
    name: "Magic UI",
    logo: "/clients/magic-ui.png",
    href: "https://magicui.design",
  },
  {
    name: "Karhba Go",
    logo: "/clients/karhba-go.ico",
  },
  {
    name: "StageUp",
    logo: "/clients/stageup.ico",
    href: "https://stage-up.vercel.app/",
  },
  {
    name: "Luna",
  },
  {
    name: "MotionEMR",
    href: "https://motionemr.com",
  },
  {
    name: "Kachouri",
    href: "https://www.kachouri-getraenke-service.de",
    logo: "/clients/kachouri.svg",
  },
]

export const OPEN_SOURCE_PROJECTS: OpenSourceProject[] = [
  {
    name: "shadcn/ui",
    description:
      "Beautifully designed components built with Radix UI and Tailwind CSS. Open source and free for everyone.",
    stars: 15243,
    language: "TypeScript",
    languageColor: "#3178c6",
    url: "https://github.com/shadcn/ui",
  },
  {
    name: "shadcn/ui",
    description:
      "Beautifully designed components built with Radix UI and Tailwind CSS. Open source and free for everyone.",
    stars: 15243,
    language: "TypeScript",
    languageColor: "#3178c6",
    url: "https://github.com/shadcn/ui",
  },
]
