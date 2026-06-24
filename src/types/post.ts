export interface Post {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  featuredImage: string;
  category: CategoryName;
  tags: string[];
  author: string;
  publishedAt: Date | string | null;
  updatedAt: Date | string | null;
  seoTitle: string;
  seoDescription: string;
  readingTime: number;
  wordCount: number;
  status: 'published' | 'draft';
  views?: number;
  faq_items?: FAQItem[];
}

export interface FAQItem {
  question: string;
  answer: string;
}

export type CategoryName =
  | 'AI Tools'
  | 'Technology Guides'
  | 'Freelancing'
  | 'Remote Work'
  | 'Side Hustles'
  | 'Software Reviews'
  | 'SEO & Blogging'
  | 'Web Development'
  | 'Startup Stories'
  | 'Productivity';

export interface Category {
  id: string;
  name: CategoryName;
  slug: string;
  description: string;
  builtin: boolean;
  postCount?: number;
}
