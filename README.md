# TIPS: A TwIPS Tool
[To-Do]: Metrics

[To-Do]: Install

[To-Do]: UserGuide

TIPS is a Chromium browser extension that provides AI-powered interpretations, previews, and suggestions for text- and image-based communication.

TIPS builds off of the TwIPS messaging platform ([https://arxiv.org/pdf/2407.17760](https://arxiv.org/pdf/2407.17760)).

## NOTE
This extension is in active development - do not expect it do work if loaded into your browser.

## Architecture
[ Chrome Extension ]
└─ (User action triggers an HTTPS request)
    │
    │
    ▼
[ AWS API Gateway ]
└─ (Exposes an HTTPS endpoint; terminates TLS)
    │
    │
    ▼
[ AWS Lambda Function ]
└─ (Executes backend logic with retrieved secrets via AWS Secrets Manager;
    calls Anthropic API, interacts with AWS S3, DynamoDB, etc.)
└─ (Collects responses and returns sanitized, non-sensitive data)
    │
    │
    ▼
[ Chrome Extension ]
└─ (Displays AI interpretations, previews, and suggestions)

## Deployment pipeline
[ GitHub Repo: TIPS ]
└─ Contains: 
    └─ Frontend code for the Chrome extension (JS/TS, HTML/CSS, Svelte)
    └─ Backend code (Python/Flask for HTTPS server & Lambda functions)
    └─ IaC Templates (tips-dev.yaml, tips-test.yaml, tips-prod.yaml)
    └─ Configuration templates (config.dev.json, etc.)
    └─ CI/CD workflows (GitHub Actions)
    └─ Documentation
    │
    | (CI/CD Pipeline with GitHub Secrets)
    ▼ 
[ AWS Environment ]
└─ API Gateway
└─ Lambda Functions
└─ S3 Buckets
└─ Secrets Manager
└─ DynamoDB
    │
    │
    ▼
[ Anthropic API ]
└─ Accessed ONLY via Lambda (secret key retrieved securely from Secrets Manager)

## Costs
Anthropic API
For image uploads: tokens = (width px * height px)/750

<a target="_blank" href="https://icons8.com/icon/12244/idea">Tip</a> icon by <a target="_blank" href="https://icons8.com">Icons8</a>