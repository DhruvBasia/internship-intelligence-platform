import { phraseRegExp } from './text';

/**
 * Skill dictionary for the free, offline matcher. Each entry is
 * [canonical name, ...aliases]. Aliases are matched case-insensitively on word
 * boundaries; entries in CASE_SENSITIVE are matched exactly (e.g. "Go", "R").
 */
const SKILLS: string[][] = [
  // Languages
  ['Python', 'python3'],
  ['Java'],
  ['JavaScript', 'js', 'ecmascript'],
  ['TypeScript'],
  ['C++', 'cpp'],
  ['C#', 'csharp', 'c sharp'],
  ['Go', 'golang'],
  ['Rust'],
  ['Kotlin'],
  ['Swift'],
  ['Scala'],
  ['Ruby'],
  ['PHP'],
  ['R'],
  ['C'],
  ['MATLAB'],
  ['Julia'],
  ['Bash', 'shell scripting', 'zsh'],
  ['SQL', 'mysql', 'postgresql', 'postgres', 'sqlite', 't-sql', 'pl/sql'],
  ['Verilog', 'systemverilog'],
  ['VHDL'],
  ['Solidity'],
  ['Dart'],
  // ML / AI
  ['Machine Learning', 'ml'],
  ['Deep Learning', 'dl', 'neural networks', 'neural network'],
  ['PyTorch', 'torch'],
  ['TensorFlow', 'tf', 'keras'],
  ['JAX', 'flax'],
  ['scikit-learn', 'sklearn', 'scikit learn'],
  ['XGBoost', 'lightgbm', 'catboost', 'gradient boosting'],
  ['NLP', 'natural language processing'],
  ['Computer Vision', 'image processing', 'opencv', 'object detection', 'image segmentation'],
  ['LLMs', 'llm', 'large language models', 'large language model', 'gpt', 'transformers', 'transformer'],
  ['Generative AI', 'genai', 'gen ai', 'diffusion models', 'diffusion'],
  ['RAG', 'retrieval augmented generation', 'retrieval-augmented generation', 'vector database', 'vector databases'],
  ['LangChain', 'langgraph', 'llamaindex'],
  ['Hugging Face', 'huggingface'],
  ['Reinforcement Learning', 'rl', 'rlhf'],
  ['MLOps', 'mlflow', 'kubeflow', 'model deployment'],
  ['CUDA', 'gpu programming'],
  ['Statistics', 'statistical modeling', 'statistical analysis', 'probability'],
  ['Data Analysis', 'data analytics', 'exploratory data analysis', 'eda'],
  ['Data Science'],
  ['Data Engineering', 'etl', 'data pipelines', 'data pipeline'],
  ['Pandas'],
  ['NumPy'],
  ['Spark', 'pyspark', 'apache spark'],
  ['Hadoop', 'hive'],
  ['Airflow', 'apache airflow'],
  ['Kafka', 'apache kafka'],
  ['dbt'],
  ['Snowflake'],
  ['BigQuery'],
  ['Databricks'],
  ['Tableau'],
  ['Power BI', 'powerbi'],
  ['Excel', 'microsoft excel', 'ms excel', 'advanced excel', 'vba', 'pivot tables'],
  ['Jupyter', 'jupyter notebooks'],
  ['Time Series', 'forecasting'],
  ['Recommender Systems', 'recommendation systems', 'recsys'],
  ['A/B Testing', 'ab testing', 'experimentation'],
  // Web / mobile
  ['React', 'react.js', 'reactjs'],
  ['Next.js', 'nextjs'],
  ['Vue', 'vue.js', 'vuejs'],
  ['Angular'],
  ['Svelte'],
  ['Node.js', 'nodejs'],
  ['Express.js', 'expressjs'],
  ['Django'],
  ['Flask'],
  ['FastAPI'],
  ['Spring Boot', 'spring framework'],
  ['Ruby on Rails', 'rails'],
  ['.NET', 'asp.net', 'dotnet'],
  ['HTML', 'html5'],
  ['CSS', 'css3', 'tailwind', 'tailwindcss', 'sass'],
  ['GraphQL'],
  ['REST APIs', 'restful', 'rest api', 'rest apis'],
  ['gRPC'],
  ['iOS', 'swiftui'],
  ['Android', 'jetpack compose'],
  ['React Native'],
  ['Flutter'],
  // Infra / cloud
  ['AWS', 'amazon web services', 'ec2', 's3', 'lambda', 'sagemaker'],
  ['GCP', 'google cloud', 'google cloud platform', 'vertex ai'],
  ['Azure', 'microsoft azure'],
  ['Docker', 'containerization'],
  ['Kubernetes', 'k8s'],
  ['Terraform', 'infrastructure as code'],
  ['CI/CD', 'ci cd', 'github actions', 'jenkins', 'continuous integration'],
  ['Linux', 'unix'],
  ['Git', 'github', 'gitlab', 'version control'],
  ['Distributed Systems', 'distributed computing'],
  ['Microservices'],
  ['System Design'],
  ['Networking', 'tcp/ip', 'computer networks'],
  ['Redis'],
  ['MongoDB', 'nosql'],
  ['Elasticsearch', 'opensearch'],
  ['Firebase'],
  // Security
  ['Cybersecurity', 'information security', 'infosec', 'application security', 'network security'],
  ['Cryptography'],
  ['Penetration Testing', 'pentesting', 'ethical hacking'],
  ['Blockchain', 'web3', 'smart contracts', 'ethereum'],
  // CS fundamentals
  ['Algorithms', 'data structures', 'dsa'],
  ['Operating Systems'],
  ['Compilers'],
  ['Databases', 'database systems', 'dbms'],
  ['Object-Oriented Programming', 'oop', 'object oriented programming'],
  ['Software Testing', 'unit testing', 'pytest', 'jest', 'test automation'],
  // Hardware / embedded / robotics
  ['Embedded Systems', 'embedded software', 'firmware', 'microcontrollers', 'arduino', 'stm32', 'rtos'],
  ['FPGA'],
  ['Robotics', 'ros', 'ros2'],
  ['Computer Architecture'],
  ['Signal Processing', 'dsp'],
  ['PCB Design', 'altium', 'kicad'],
  ['CAD', 'solidworks', 'autocad', 'fusion 360'],
  // Quant / finance
  ['Quantitative Finance', 'quant', 'derivatives', 'options pricing'],
  ['Linear Algebra'],
  ['Optimization', 'convex optimization', 'operations research'],
  // Product / design
  ['Figma', 'ui design', 'ux design', 'ui/ux'],
  ['Product Management', 'product sense', 'roadmapping'],
  // GIS / research
  ['GIS', 'arcgis', 'qgis', 'geospatial', 'remote sensing'],
  ['Research', 'research experience', 'publications'],
  ['LaTeX'],
];

// Skills whose names are also everyday words ("go", "excel at") only count when capitalised.
const CASE_SENSITIVE = new Set(['Go', 'R', 'C', 'Excel']);
const CASE_SENSITIVE_PATTERNS: Record<string, RegExp> = {
  Excel: /(?:^|[^A-Za-z])(?:MS |Microsoft )?Excel(?![A-Za-z])/,
  Go: /(?:^|[\s,(/])Go(?=[\s,)/.;]|$)(?!\s+(?:to|ahead|beyond|live|back|over)\b)/,
  R: /(?:^|[\s,(/])R(?=[\s,)/;]|$)(?![&\-]|\s*&)/,
  C: /(?:^|[\s,(/])C(?=[\s,)/;]|$)(?![+#&\-])/,
};

interface CompiledSkill {
  name: string;
  patterns: RegExp[];
}

let compiled: CompiledSkill[] | null = null;

function compile(): CompiledSkill[] {
  if (compiled) return compiled;
  compiled = SKILLS.map(([name, ...aliases]) => {
    const patterns: RegExp[] = [];
    if (CASE_SENSITIVE.has(name!)) {
      patterns.push(CASE_SENSITIVE_PATTERNS[name!]!);
      for (const a of aliases) patterns.push(phraseRegExp(a));
    } else {
      for (const a of [name!, ...aliases]) {
        // Two-letter aliases like "ml", "cv", "ts", "tf" are too noisy in prose; require upper-case.
        if (a.length <= 2) patterns.push(phraseRegExp(a.toUpperCase(), ''));
        else patterns.push(phraseRegExp(a));
      }
    }
    return { name: name!, patterns };
  });
  return compiled;
}

/** Canonical skills mentioned in free text. */
export function extractSkills(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const skill of compile()) {
    if (skill.patterns.some((p) => p.test(text))) found.push(skill.name);
  }
  return found;
}

/** Map a user-entered skill to its canonical name, or keep it as-is if unknown. */
export function canonicalSkill(input: string): string {
  const s = input.trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  for (const [name, ...aliases] of SKILLS) {
    if (name!.toLowerCase() === lower || aliases.some((a) => a.toLowerCase() === lower)) return name!;
  }
  return s;
}

export function allSkillNames(): string[] {
  return SKILLS.map((s) => s[0]!);
}
