/**
 * Everything the landing page renders that is copy rather than logic — nav
 * items, section content, and the interview module catalogue.
 */
import {
  Activity,
  AudioLines,
  Brain,
  CheckCircle2,
  Crosshair,
  Eye,
  FileText,
  Globe,
  LayoutGrid,
  Lock,
  type LucideIcon,
  MessageSquare,
  ShieldCheck,
  Smile,
  Star,
  Users,
  Video,
} from "lucide-react"
/* ==========================================================================
   content.ts
   ========================================================================== */

export interface NavItem {
  target: string
  label: string
}

export const navItems: NavItem[] = [
  { target: "home", label: "Overview" },
  { target: "how", label: "How It Works" },
  { target: "trust", label: "Trust & Security" },
  { target: "api", label: "Architecture & API" },
  { target: "access", label: "Request Access" },
]

/** Sections observed for the active nav-link underline. */
export const navSections = ["home", "how", "trust", "api", "access"] as const

export const rotatorWords = ["Hire", "Build", "Lead", "Screen"] as const

export interface AgentRow {
  label: string
  status: string
}

export const activeModuleRows: AgentRow[] = [
  { label: "Proctoring", status: "Active" },
  { label: "Psychometrics", status: "Active" },
  { label: "Vitals Monitor", status: "Consent" },
  { label: "Voice Synthesis", status: "Active" },
  { label: "Role Alignment", status: "Active" },
  { label: "Sentiment Analysis", status: "Active" },
]

export const oceanTraits = [
  { letter: "O", value: 72 },
  { letter: "C", value: 68 },
  { letter: "E", value: 55 },
  { letter: "A", value: 74 },
  { letter: "N", value: 41 },
]

export interface HowStep {
  Icon: LucideIcon
  title: string
  desc: string
}

export const howSteps: HowStep[] = [
  {
    Icon: Crosshair,
    title: "Define the Need",
    desc: "Identify the requirement and the signals that matter.",
  },
  {
    Icon: FileText,
    title: "Upload the Brief",
    desc: "Paste, link, or upload the role requirements.",
  },
  {
    Icon: MessageSquare,
    title: "Dynamic Interviewing",
    desc: "Role-specific questions, generated and adapted in real time.",
  },
  {
    Icon: Video,
    title: "Live Session",
    desc: "Proctored, voice-driven, and fully consensual.",
  },
  {
    Icon: LayoutGrid,
    title: "Parallel Processing",
    desc: "Ten specialized modules analyze the session in unison.",
  },
  {
    Icon: Star,
    title: "Composite Score",
    desc: "A clear measure of fit, backed by confidence intervals.",
  },
  {
    Icon: Eye,
    title: "Transparent Review",
    desc: "Explainable evidence mapped directly to the candidate.",
  },
  {
    Icon: CheckCircle2,
    title: "Human Decision",
    desc: "You make the call. We provide the clarity.",
  },
]

export interface TrustCard {
  Icon: LucideIcon
  title: string
  desc: string
}

export const trustCards: TrustCard[] = [
  {
    Icon: ShieldCheck,
    title: "SOC 2 Type II",
    desc: "Annual audits covering security and confidentiality.",
  },
  {
    Icon: Lock,
    title: "GDPR Compliant",
    desc: "Full audit trails for consent and data processing.",
  },
  {
    Icon: LayoutGrid,
    title: "EEOC Aligned",
    desc: "Structured interviews and documented decision trails.",
  },
  {
    Icon: Globe,
    title: "Data Residency",
    desc: "Process and store data in US, EU, or APAC.",
  },
]

export interface ConsentStatement {
  id: string
  label: string
}

export const consentStatements: ConsentStatement[] = [
  {
    id: "media",
    label: "I consent to camera and microphone access for this session.",
  },
  {
    id: "vision",
    label:
      "I understand my video is analyzed locally for face tracking and gaze.",
  },
  {
    id: "vitals",
    label:
      "I consent to non-contact vitals estimation from webcam video using rPPG.",
  },
  {
    id: "human",
    label:
      "I understand the final hiring decision is made by a human recruiter.",
  },
]

export const fallbackQuestions = [
  "To start, could you walk me through your professional background and what interests you about this role?",
  "Tell me about a recent project where you had to overcome a significant technical or interpersonal challenge.",
  "How do you prioritize competing deadlines when everything seems urgent?",
  "Describe a moment when you received critical feedback. How did you respond?",
  "What does growth look like for you over the next two to three years?",
]

export const companySizes = ["1–10", "11–50", "51–200", "201–1000", "1000+"]

export const useCases = [
  "High-volume screening",
  "Technical hiring",
  "Campus & graduate hiring",
  "Internal mobility",
  "Executive search",
  "Remote-first hiring",
]

/* ==========================================================================
   modules.ts
   ========================================================================== */

export interface InterviewModule {
  id: string
  name: string
  shortName: string
  Icon: LucideIcon
  endpoint: string
  apiKey: string
  desc: string
  tags: string[]
  sample: Record<string, string | number | boolean>
  request: string
  response: string
  notes: string
}

export const modules: InterviewModule[] = [
  {
    id: "01",
    name: "Proctoring Module",
    shortName: "Proctoring",
    Icon: Eye,
    endpoint: "/v1/modules/proctor",
    apiKey: "live_••••••••3f9a",
    desc: "Real-time face tracking, gaze monitoring, tab-switch detection, multi-face alerts, and confidence-scored signals during live interviews.",
    tags: [
      "Face & Gaze Tracking",
      "Tab Switch Detection",
      "Multi-Face Alert",
      "Confidence Scoring",
    ],
    sample: { risk: "Low", gaze: "94%", flags: 0, faces: 1 },
    request: `curl -X POST https://api.yourplatform.ai/v1/modules/proctor/start \\
  -H "Authorization: Bearer live_••••3f9a" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "sess_7f3a9b2c",
    "stream_url": "wss://interview.yourplatform.ai/sess_7f3a9b2c",
    "sensitivity": "balanced",
    "flags": ["gaze", "tab_switch", "multi_face"]
  }'`,
    response: `{
  "session_id": "sess_7f3a9b2c",
  "status": "monitoring",
  "module": "proctoring",
  "started_at": "2025-01-15T14:23:11Z",
  "config": {
    "sensitivity": "balanced",
    "flags": ["gaze", "tab_switch", "multi_face"]
  }
}`,
    notes:
      'Stream video frames to the provided WebSocket URL. Confidence-scored risk events are pushed in real time. Use sensitivity "strict" for high-stakes roles, "balanced" for general hiring, "relaxed" for internal mobility.',
  },
  {
    id: "02",
    name: "Psychometrics Module",
    shortName: "Psychometrics",
    Icon: Brain,
    endpoint: "/v1/modules/psychometrics",
    apiKey: "live_••••••••7b2e",
    desc: "OCEAN Big Five and Cattell 16PF personality profiling drawn from natural conversation, presented as clear signals for human review.",
    tags: ["OCEAN Big-5", "16PF Scoring", "Probe Guidance", "Trait Trajectory"],
    sample: { O: 72, C: 68, E: 55, A: 74, N: 41, profile: "Steady Analyst" },
    request: `curl -X POST https://api.yourplatform.ai/v1/modules/psychometrics/analyze \\
  -H "Authorization: Bearer live_••••7b2e" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "sess_7f3a9b2c",
    "transcript_id": "tr_8e2c1f9d",
    "model": "ocean_16pf_v3",
    "depth": "full"
  }'`,
    response: `{
  "session_id": "sess_7f3a9b2c",
  "ocean": { "O": 72, "C": 68, "E": 55, "A": 74, "N": 41 },
  "16pf": { "warmth": 61, "reasoning": 78, "emotional_stability": 69 },
  "profile": "Steady Analyst",
  "confidence": 0.86
}`,
    notes:
      'Requires at least 4 minutes of transcripted conversation for a reliable profile. Use "depth": "quick" for a fast OCEAN-only read, or "full" for the combined OCEAN + 16PF profile. All outputs are illustrative signals for human review.',
  },
  {
    id: "03",
    name: "Vitals Module",
    shortName: "Vitals",
    Icon: Activity,
    endpoint: "/v1/modules/vitals",
    apiKey: "live_••••••••c4d1",
    desc: "Consent-based, non-contact vital signs estimated from webcam video using rPPG. Includes heart rate, HRV, stress indicators, SpO2, and respiratory rate.",
    tags: [
      "Heart Rate BPM",
      "HRV & Stress Index",
      "Respiratory Rate",
      "Video Overlay",
    ],
    sample: { hr: 72, hrv: 48, stress: "Low", spo2: 98, rr: 14 },
    request: `curl -X POST https://api.yourplatform.ai/v1/modules/vitals/start \\
  -H "Authorization: Bearer live_••••c4d1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "sess_7f3a9b2c",
    "video_stream": "wss://interview.yourplatform.ai/sess_7f3a9b2c/video",
    "consent_token": "con_5a8b3c2d",
    "metrics": ["hr", "hrv", "stress", "spo2", "rr"]
  }'`,
    response: `{
  "session_id": "sess_7f3a9b2c",
  "status": "monitoring",
  "baseline": { "hr": 74, "hrv": 46 },
  "streaming": true,
  "consent_verified": true
}`,
    notes:
      "Requires explicit candidate consent via a signed consent_token. Vitals are estimated using remote photoplethysmography (rPPG) from webcam frames—no contact devices needed. All readings carry a confidence band.",
  },
  {
    id: "04",
    name: "Voice Synthesis Module",
    shortName: "Voice Synthesis",
    Icon: AudioLines,
    endpoint: "/v1/modules/voice",
    apiKey: "live_••••••••e9f4",
    desc: "Emotion-aware text-to-speech for the system interviewer, featuring configurable voice settings and real-time streaming.",
    tags: [
      "Emotion-Aware TTS",
      "Voice Library",
      "Real-Time Synthesis",
      "WebSocket Streaming",
    ],
    sample: {
      voice: "aria_v2",
      latency: "120ms",
      emotion: "curious",
      ssml: true,
    },
    request: `curl -X POST https://api.yourplatform.ai/v1/modules/voice/synthesize \\
  -H "Authorization: Bearer live_••••e9f4" \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "Tell me about a system you designed under scale constraints.",
    "voice": "aria_v2",
    "emotion": "curious",
    "stream": true,
    "format": "pcm_24khz"
  }'`,
    response: `{
  "audio_id": "aud_3f7e2b1c",
  "voice": "aria_v2",
  "emotion": "curious",
  "duration_ms": 3200,
  "stream_url": "wss://api.yourplatform.ai/v1/stream/aud_3f7e2b1c",
  "latency_ms": 120
}`,
    notes:
      "Stream audio chunks over WebSocket for real-time playback. The voice library includes 14 interviewer-grade voices. Emotion parameters influence pacing, pitch contour, and emphasis—not just affect.",
  },
  {
    id: "05",
    name: "Role Alignment Module",
    shortName: "Role Alignment",
    Icon: FileText,
    endpoint: "/v1/modules/role-alignment",
    apiKey: "live_••••••••a1b8",
    desc: "Upload a job description, and the module generates role-specific questions with integrated psychometric probing and session tracking.",
    tags: [
      "JD Parsing: Text / PDF / URL",
      "Dynamic Questions",
      "Psychometric Integration",
      "Session Tracking",
    ],
    sample: {
      questions: 12,
      difficulty: "adaptive",
      probing: true,
      fitScore: 88,
    },
    request: `curl -X POST https://api.yourplatform.ai/v1/modules/role-alignment/generate \\
  -H "Authorization: Bearer live_••••a1b8" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jd_source": { "type": "text", "content": "Senior Backend Engineer..." },
    "question_count": 12,
    "difficulty": "adaptive",
    "psychometric_probing": true
  }'`,
    response: `{
  "assessment_id": "as_9c4e2f1a",
  "questions": [
    { "id": "q1", "text": "Describe a system you designed under scale constraints.", "probe": "decision_making" }
  ],
  "estimated_duration_min": 28,
  "psychometric_coverage": 0.91
}`,
    notes:
      'Accepts JD as raw text, PDF (file upload), or public URL. Generated questions are tagged with the psychometric trait they help surface. Use "difficulty": "adaptive" to adjust question difficulty based on candidate responses.',
  },
  {
    id: "06",
    name: "Verification Module",
    shortName: "Verification",
    Icon: ShieldCheck,
    endpoint: "/v1/modules/verification",
    apiKey: "live_••••••••d6e3",
    desc: "Identity verification, certificate authenticity checks, background verification, face matching, and confidence-scored risk assessment.",
    tags: [
      "Face-to-ID Matching",
      "Certificate Verification",
      "Background Checks",
      "Risk Assessment",
    ],
    sample: {
      match: "98.2%",
      certs: "Verified",
      background: "Clear",
      risk: "Low",
    },
    request: `curl -X POST https://api.yourplatform.ai/v1/modules/verification/verify \\
  -H "Authorization: Bearer live_••••d6e3" \\
  -H "Content-Type: application/json" \\
  -d '{
    "candidate_id": "cand_4b7e2f1a",
    "live_face_image": "<base64>",
    "id_document": { "type": "passport", "image": "<base64>" },
    "certificates": [{ "id": "cert_aws_solutions_architect" }]
  }'`,
    response: `{
  "verification_id": "ver_2a8b3c1d",
  "face_match": { "score": 0.982, "decision": "match" },
  "certificates": [{ "id": "cert_aws_solutions_architect", "status": "verified" }],
  "background": { "status": "clear" },
  "risk": "low"
}`,
    notes:
      'Face-to-ID matching uses a 0.97 threshold for "match" decision. Certificate verification checks issuing authority databases. Background checks are region-specific and require additional candidate consent.',
  },
  {
    id: "07",
    name: "Recording Analysis Module",
    shortName: "Recording",
    Icon: Video,
    endpoint: "/v1/modules/recording",
    apiKey: "live_••••••••f2a7",
    desc: "Upload interview recordings and analyze them for integrity signals, psychometrics, emotions, and exportable PDF reports for human review.",
    tags: [
      "Video Upload & Analysis",
      "Frame-by-Frame Proctoring",
      "Psychometric Scoring",
      "PDF Report Download",
    ],
    sample: {
      duration: "32 min",
      proctorFlags: 2,
      psychProfile: "Complete",
      report: "pdf_9f2e1a",
    },
    request: `curl -X POST https://api.yourplatform.ai/v1/modules/recording/analyze \\
  -H "Authorization: Bearer live_••••f2a7" \\
  -H "Content-Type: application/json" \\
  -d '{
    "recording_url": "https://storage.yourplatform.ai/interviews/rec_8e2c1f9d.mp4",
    "analysis_types": ["proctoring", "psychometrics", "emotions"],
    "report_format": "pdf"
  }'`,
    response: `{
  "analysis_id": "an_5b3c8e2f",
  "status": "processing",
  "estimated_completion_min": 4,
  "webhook_url": "https://api.yourplatform.ai/v1/webhooks/analysis/notify"
}`,
    notes:
      "Accepts MP4, MOV, and WebM up to 2GB. Analysis is asynchronous—you receive a webhook notification when complete. The PDF report includes frame-by-frame proctoring timeline, psychometric charts, and emotion trajectory.",
  },
  {
    id: "08",
    name: "IO Sciences Module",
    shortName: "IO Sciences",
    Icon: LayoutGrid,
    endpoint: "/v1/modules/io-sciences",
    apiKey: "live_••••••••b8c5",
    desc: "Role-based organizational assessments with challenge-specific, dynamic limits, designed for evidence-backed review.",
    tags: [
      "Role-Based Challenges",
      "10-Question Limit",
      "Dynamic Assessment",
      "IO Science Scoring",
    ],
    sample: {
      role: "Engineering Manager",
      questions: 10,
      score: 84,
      percentile: 78,
    },
    request: `curl -X POST https://api.yourplatform.ai/v1/modules/io-sciences/assess \\
  -H "Authorization: Bearer live_••••b8c5" \\
  -H "Content-Type: application/json" \\
  -d '{
    "candidate_id": "cand_4b7e2f1a",
    "role": "engineering_manager",
    "challenge_set": "leadership_conflict",
    "question_limit": 10
  }'`,
    response: `{
  "assessment_id": "io_3e7b2c1d",
  "questions_delivered": 10,
  "score": 84,
  "percentile": 78,
  "trait_breakdown": {
    "leadership": 88,
    "decision_making": 82,
    "conflict_resolution": 79
  }
}`,
    notes:
      "Each assessment is capped at 10 questions per challenge set. Challenge sets are role-specific and validated against IO science frameworks. Scores are normalized against a benchmark population for percentile calculation.",
  },
  {
    id: "09",
    name: "Sentiment Module",
    shortName: "Sentiment",
    Icon: Smile,
    endpoint: "/v1/modules/sentiment",
    apiKey: "live_••••••••e1f2",
    desc: "Real-time analysis of vocal intonation and facial expressions to gauge candidate sentiment, ensuring emotional alignment with responses.",
    tags: [
      "Vocal Tone Analysis",
      "Facial Expression Mapping",
      "Real-time Sentiment",
      "Emotional Baseline",
    ],
    sample: {
      sentiment: "Positive",
      tone: "Confident",
      smileRatio: 0.4,
      engagement: "High",
    },
    request: `curl -X POST https://api.yourplatform.ai/v1/modules/sentiment/start \\
  -H "Authorization: Bearer live_••••e1f2" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "sess_7f3a9b2c",
    "audio_stream": "wss://interview.yourplatform.ai/sess_7f3a9b2c/audio",
    "video_stream": "wss://interview.yourplatform.ai/sess_7f3a9b2c/video"
  }'`,
    response: `{
  "session_id": "sess_7f3a9b2c",
  "status": "monitoring",
  "sentiment": "Positive",
  "tone": "Confident",
  "smile_ratio": 0.42,
  "engagement": "High"
}`,
    notes:
      "Requires both audio and video streams. Useful for sales, customer success, and leadership roles where emotional intelligence is critical.",
  },
  {
    id: "10",
    name: "Culture & Values Module",
    shortName: "Culture & Values",
    Icon: Users,
    endpoint: "/v1/modules/culture-fit",
    apiKey: "live_••••••••a3b4",
    desc: "Evaluates alignment with company values and team dynamics based on conversational cues and scenario-based questioning.",
    tags: [
      "Values Alignment",
      "Team Dynamics",
      "Scenario Scoring",
      "Culture Matrix",
    ],
    sample: {
      alignment: "Strong",
      adaptability: "High",
      collaboration: "Proven",
      risk: "Low",
    },
    request: `curl -X POST https://api.yourplatform.ai/v1/modules/culture-fit/evaluate \\
  -H "Authorization: Bearer live_••••a3b4" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "sess_7f3a9b2c",
    "culture_matrix_id": "cm_northwind_labs",
    "transcript_id": "tr_8e2c1f9d"
  }'`,
    response: `{
  "session_id": "sess_7f3a9b2c",
  "alignment": "Strong",
  "adaptability": "High",
  "collaboration": "Proven",
  "risk": "Low"
}`,
    notes:
      "Requires a pre-configured company culture matrix. The module generates dynamic scenario questions based on your defined core values.",
  },
]
