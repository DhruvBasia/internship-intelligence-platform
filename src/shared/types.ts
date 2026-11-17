/**
 * Shared domain types and the RPC contract between the Apps Script server
 * and the browser client. Everything here must stay JSON-serialisable:
 * google.script.run cannot carry Dates, functions or class instances.
 */

export const STAGES = ['discovered', 'saved', 'applied', 'interviewing', 'offer', 'rejected', 'archived'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  discovered: 'Discovered',
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  archived: 'Archived',
};

export const WORK_MODES = ['remote', 'hybrid', 'onsite', 'unknown'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const DEGREES = ['', 'highschool', 'bachelors', 'masters', 'phd', 'other'] as const;
export type Degree = (typeof DEGREES)[number];

export type SourceKind = 'simplify' | 'greenhouse' | 'lever' | 'ashby' | 'hn' | 'wwr' | 'url' | 'manual' | 'import';

export type Verdict = 'strong' | 'good' | 'stretch' | 'weak';
export type MatchMethod = 'local' | 'ai';

export interface ScoreBreakdown {
  /** Overlap between the candidate's skills and the posting's skills. */
  skills: number;
  /** Alignment between the posting and the candidate's target roles. */
  role: number;
  /** Eligibility: degree, graduation window, seniority. */
  level: number;
  /** Location, work mode and work authorisation. */
  location: number;
}

export interface MatchResult {
  score: number;
  breakdown: ScoreBreakdown;
  verdict: Verdict;
  summary: string;
  strengths: string[];
  gaps: string[];
  tips: string[];
  flags: string[];
  matchedSkills: string[];
  missingSkills: string[];
  method: MatchMethod;
  model: string;
  scoredAt: string;
  profileHash: string;
}

/** AI analysis lifecycle. 'none' = never requested, 'queued' = waiting for quota/worker. */
export type AiStatus = 'none' | 'queued' | 'done' | 'failed';

export interface Job {
  id: string;
  source: SourceKind;
  sourceLabel: string;
  sourceRef: string;
  url: string;
  company: string;
  role: string;
  location: string;
  workMode: WorkMode;
  description: string;
  requirements: string;
  tags: string[];
  postedAt: string;
  deadline: string;
  deadlineText: string;
  stage: Stage;
  stageChangedAt: string;
  appliedAt: string;
  followUpAt: string;
  starred: boolean;
  notes: string;
  score: number;
  match: MatchResult | null;
  local: MatchResult | null;
  aiStatus: AiStatus;
  aiError: string;
  aiAttempts: number;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight job shape sent in lists; full text is fetched on demand. */
export type JobSummary = Omit<Job, 'description' | 'requirements' | 'local'> & { snippet: string };

export interface ActivityEntry {
  id: string;
  at: string;
  jobId: string;
  type: ActivityType;
  message: string;
}

export type ActivityType =
  | 'discovered'
  | 'created'
  | 'stage'
  | 'scored'
  | 'ai'
  | 'note'
  | 'letter'
  | 'deleted'
  | 'refresh'
  | 'import'
  | 'digest'
  | 'settings'
  | 'error';

export interface Profile {
  name: string;
  school: string;
  degree: Degree;
  gradYear: number | null;
  skills: string[];
  targetRoles: string[];
  locations: string[];
  workModes: WorkMode[];
  needsSponsorship: boolean;
  resumeText: string;
  links: { github: string; linkedin: string; portfolio: string };
}

export type AiProvider = 'gemini' | 'openai_compat' | 'none';

export interface Board {
  ats: 'greenhouse' | 'lever' | 'ashby';
  token: string;
  name: string;
}

export interface Settings {
  ai: {
    provider: AiProvider;
    model: string;
    /** OpenAI-compatible base URL (Groq, OpenRouter, a local server, ...). */
    baseUrl: string;
    /** Max AI requests per day; protects free-tier quotas. */
    dailyLimit: number;
    /** Postings per AI request. Batching keeps free-tier request counts low. */
    batchSize: number;
    /** Automatically queue AI analysis for jobs whose free score is at least this. */
    autoMinScore: number;
    autoAnalyze: boolean;
  };
  sources: {
    simplify: { enabled: boolean; categories: string[] };
    hn: { enabled: boolean };
    wwr: { enabled: boolean };
    boards: Board[];
  };
  filters: {
    internshipsOnly: boolean;
    includeKeywords: string[];
    excludeKeywords: string[];
    maxAgeDays: number;
    maxNewPerRefresh: number;
  };
  automation: {
    enabled: boolean;
    hour: number;
    timezone: string;
    digest: boolean;
    digestThreshold: number;
  };
  mail: {
    /** Scan Gmail automatically every hour (needs the mail feature in this deployment). */
    enabled: boolean;
    /** Create/update internship applications from placement emails. */
    autoTrack: boolean;
    /** How far back the first scan looks. */
    lookbackDays: number;
    /** Extra senders (addresses or domains) that always count as important. */
    extraSenders: string[];
  };
  onboarded: boolean;
}

/** Settings as the client sees them: secrets are reduced to presence flags. */
export interface SettingsView extends Settings {
  secrets: { gemini: boolean; openai_compat: boolean };
}

export interface UsageView {
  date: string;
  aiRequests: number;
  aiJobs: number;
  dailyLimit: number;
  cooldownUntil: string;
}

export interface SourceReport {
  id: string;
  label: string;
  fetched: number;
  relevant: number;
  added: number;
  error: string;
  ms: number;
}

export interface RefreshReport {
  startedAt: string;
  finishedAt: string;
  sources: SourceReport[];
  added: number;
  duplicates: number;
  aiAnalyzed: number;
  aiQueued: number;
  aiError: string;
}

export interface Stats {
  total: number;
  byStage: Record<Stage, number>;
  newThisWeek: number;
  strongMatches: number;
  avgScore: number;
  upcomingDeadlines: number;
}

export interface BootstrapData {
  version: string;
  user: { email: string };
  profile: Profile;
  settings: SettingsView;
  usage: UsageView;
  jobs: JobSummary[];
  activity: ActivityEntry[];
  sheetUrl: string;
  lastRefresh: RefreshReport | null;
  migratedFromV1: number;
  features: Features;
  programs: Program[];
  exams: Exam[];
  tasks: Task[];
  mail: MailItem[];
  lastMailScan: MailReport | null;
}

export interface JobInput {
  company: string;
  role: string;
  url?: string;
  location?: string;
  description?: string;
  requirements?: string;
  deadline?: string;
  notes?: string;
  stage?: Stage;
}

export interface JobPatch {
  stage?: Stage;
  starred?: boolean;
  notes?: string;
  deadline?: string;
  followUpAt?: string;
  company?: string;
  role?: string;
  location?: string;
  url?: string;
  description?: string;
  requirements?: string;
}

export interface ModelInfo {
  id: string;
  label: string;
}

export interface CoverLetterOptions {
  tone: 'professional' | 'enthusiastic' | 'concise';
  length: 'short' | 'standard';
}

export interface ImportResult {
  added: number;
  skipped: number;
  jobs: JobSummary[];
}

/**
 * The RPC surface. Each method maps 1:1 to a top-level Apps Script function
 * and returns an {@link RpcResult} envelope.
 */
export interface Api {
  bootstrap(): BootstrapData;
  saveProfile(profile: Profile): { profile: Profile; jobs: JobSummary[] };
  saveSettings(patch: DeepPartial<Settings>): { settings: SettingsView };
  completeOnboarding(): { settings: SettingsView };
  setSecret(provider: Exclude<AiProvider, 'none'>, key: string): { settings: SettingsView; models: ModelInfo[] };
  clearSecret(provider: Exclude<AiProvider, 'none'>): { settings: SettingsView };
  listModels(): { models: ModelInfo[] };
  testAi(): { model: string; ms: number };
  getUsage(): { usage: UsageView };
  listJobs(): { jobs: JobSummary[] };
  getJob(id: string): { job: Job; coverLetter: string; activity: ActivityEntry[] };
  createJob(input: JobInput): { job: JobSummary };
  updateJob(id: string, patch: JobPatch): { job: JobSummary };
  bulkUpdate(ids: string[], patch: Pick<JobPatch, 'stage' | 'starred'>): { jobs: JobSummary[] };
  deleteJobs(ids: string[]): { deleted: string[] };
  refreshNow(): { report: RefreshReport; jobs: JobSummary[]; usage: UsageView };
  addFromUrl(url: string): { job: JobSummary; duplicate: boolean };
  analyzeWithAi(ids: string[]): { jobs: JobSummary[]; usage: UsageView; error: string };
  rescoreAll(): { jobs: JobSummary[]; queued: number };
  generateCoverLetter(id: string, options: CoverLetterOptions): { text: string; method: MatchMethod; usage: UsageView };
  saveCoverLetter(id: string, text: string): { savedAt: string };
  importTsv(text: string): ImportResult;
  importStarterPack(): ImportResult;
  importFromSheet(url: string): ImportResult;
  resolveBoard(input: string): { board: Board; openRoles: number; internRoles: number };
  getActivity(limit: number): { activity: ActivityEntry[] };
  deleteAllData(confirm: string): { sheetUrl: string };

  updateProgram(id: string, patch: ProgramPatch): { program: Program };
  createProgram(input: ProgramPatch & { name: string }): { program: Program };
  deleteProgram(id: string): { deleted: string };
  updateExam(id: string, patch: ExamPatch): { exam: Exam };
  createExam(input: ExamPatch & { name: string }): { exam: Exam };
  deleteExam(id: string): { deleted: string };
  refreshCatalogs(): { programs: Program[]; exams: Exam[]; added: number };
  createTask(input: TaskInput): { task: Task };
  updateTask(id: string, patch: TaskPatch): { task: Task };
  deleteTask(id: string): { deleted: string };
  scanMail(): { report: MailReport; mail: MailItem[]; jobs: JobSummary[]; tasks: Task[] };
  mailAction(id: string, action: MailAction): { mail: MailItem; task: Task | null; job: JobSummary | null };
}

export type MailAction = 'done' | 'ignore' | 'restore' | 'task' | 'apply-stage';

export type ProgramPatch = Partial<
  Pick<Program, 'stage' | 'starred' | 'myNotes' | 'fit' | 'docs' | 'deadline' | 'deadlineText' | 'name' | 'org' | 'url' | 'region' | 'funding' | 'money' | 'requirements'>
>;
export type ExamPatch = Partial<Pick<Exam, 'stage' | 'starred' | 'myNotes' | 'applicationNo' | 'name' | 'body' | 'category' | 'url' | 'events' | 'eligibility'>>;

export type ApiMethod = keyof Api;

export type RpcError = { code: ErrorCode; message: string; ref?: string };
export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcError };

export type ErrorCode =
  | 'BAD_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_QUOTA'
  | 'AI_FAILED'
  | 'FETCH_FAILED'
  | 'BUSY'
  | 'INTERNAL';

// ---------------------------------------------------------------------------
// Further studies, government exams, tasks and mail

/** Which part of life a date belongs to; drives calendar colour and filters. */
export type Area = 'internships' | 'studies' | 'exams' | 'general';

export const PROGRAM_STAGES = ['shortlisted', 'preparing', 'applied', 'interview', 'admitted', 'rejected', 'dropped'] as const;
export type ProgramStage = (typeof PROGRAM_STAGES)[number];
export const PROGRAM_STAGE_LABELS: Record<ProgramStage, string> = {
  shortlisted: 'Shortlisted',
  preparing: 'Preparing',
  applied: 'Applied',
  interview: 'Interview',
  admitted: 'Admitted',
  rejected: 'Rejected',
  dropped: 'Dropped',
};
export type Funding = 'full' | 'free' | 'part' | 'fee' | 'none';
export type Fit = 'top' | 'ok' | 'reach' | 'skip' | '';

export const DOC_KEYS = ['cv', 'sop', 'lor', 'transcripts', 'english', 'video', 'portfolio'] as const;
export type DocKey = (typeof DOC_KEYS)[number];
export const DOC_LABELS: Record<DocKey, string> = {
  cv: 'CV',
  sop: 'Statement of purpose',
  lor: 'Recommendation letters',
  transcripts: 'Transcripts',
  english: 'IELTS / TOEFL',
  video: 'Video',
  portfolio: 'Portfolio',
};
export type DocStatus = 'todo' | 'doing' | 'done' | 'na';

export interface Program {
  id: string;
  key: string;
  region: string;
  name: string;
  org: string;
  url: string;
  deadline: string;
  deadlineText: string;
  confirmed: boolean;
  funding: Funding;
  money: string;
  requirements: string;
  fit: Fit;
  note: string;
  stage: ProgramStage;
  starred: boolean;
  docs: Partial<Record<DocKey, DocStatus>>;
  myNotes: string;
  source: 'catalog' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export const EXAM_STAGES = ['watching', 'preparing', 'applied', 'admit-card', 'appeared', 'qualified', 'dropped'] as const;
export type ExamStage = (typeof EXAM_STAGES)[number];
export const EXAM_STAGE_LABELS: Record<ExamStage, string> = {
  watching: 'Watching',
  preparing: 'Preparing',
  applied: 'Applied',
  'admit-card': 'Admit card',
  appeared: 'Appeared',
  qualified: 'Qualified',
  dropped: 'Not pursuing',
};

export interface ExamEvent {
  label: string;
  /** YYYY-MM-DD; with precision 'month' the day is a placeholder (1st). */
  date: string;
  precision: 'day' | 'month';
}

export type ExamEligibility = 'eligible' | 'final-year-ok' | 'check' | 'not-eligible';

export interface Exam {
  id: string;
  key: string;
  name: string;
  body: string;
  category: string;
  field: 'core' | 'general';
  eligibility: string;
  forYou: ExamEligibility;
  forYouNote: string;
  age: string;
  url: string;
  confidence: 'official' | 'expected' | 'watch';
  events: ExamEvent[];
  notes: string;
  stage: ExamStage;
  starred: boolean;
  myNotes: string;
  applicationNo: string;
  source: 'catalog' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  /** YYYY-MM-DD, or YYYY-MM-DDTHH:mm (local time) when allDay is false; '' for undated. */
  due: string;
  allDay: boolean;
  area: Area;
  status: 'todo' | 'done';
  source: 'manual' | 'mail' | 'roadmap';
  link: string;
  notes: string;
  refType: '' | 'job' | 'program' | 'exam';
  refId: string;
  mailId: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskInput = Partial<Pick<Task, 'title' | 'due' | 'allDay' | 'area' | 'link' | 'notes' | 'refType' | 'refId'>>;
export type TaskPatch = Partial<Pick<Task, 'title' | 'due' | 'allDay' | 'area' | 'status' | 'link' | 'notes'>>;

export const MAIL_CATEGORIES = ['eligible', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'on-hold', 'admissions', 'exam', 'deadline', 'other'] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export interface MailItem {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  subject: string;
  snippet: string;
  date: string;
  category: MailCategory;
  area: Area;
  company: string;
  role: string;
  due: string;
  allDay: boolean;
  suggestedStage: Stage | '';
  jobId: string;
  taskId: string;
  status: 'new' | 'done' | 'ignored';
  url: string;
  createdAt: string;
}

export interface MailReport {
  at: string;
  scanned: number;
  added: number;
  important: number;
  jobsCreated: number;
  jobsUpdated: number;
  tasksCreated: number;
  error: string;
}

export interface Features {
  /** Gmail scanning is compiled in only for deployments that request the read-only Gmail scope. */
  mail: boolean;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
