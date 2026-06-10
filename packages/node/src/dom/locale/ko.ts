import type { LocaleContribution } from "./types.js";

/**
 * Korean (ko-KR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ko-KR, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking
 * / Pro — the "• 확장" suffix is a descriptor). Not yet captured — fall back to English +
 * `selector_drift`: `download`, `downloadImage`, `imageContainerHint`, `transientAssistant`,
 * `stopControl`, and the login/captcha/rate-limit blocker copy.
 */
export const ko = {
  composerTextbox: ["ChatGPT와 채팅"],
  sendButton: ["프롬프트 보내기"],
  searchChatsButton: ["채팅 검색"],
  searchChatsPlaceholder: ["채팅 검색…"],
  newChat: ["새 채팅"],
  addFilesButton: ["파일 추가 및 기타"],
  addFilesOpenerCandidates: ["파일 추가 및 기타"],
  addPhotosFilesMenuItem: ["사진 및 파일 추가"],
  copyResponse: ["응답 복사"],
  modeOpenerExtra: ["구성…"],
  tools: {
    web_search: ["웹 검색"],
    deep_research: ["심층 리서치"],
    create_image: ["이미지 만들기"],
  },
  signedInMarkers: ["새 채팅", "채팅 검색", "최근", "채팅 기록", "프로젝트", "ChatGPT와 채팅"],
  responseActions: ["응답 복사"],
} satisfies LocaleContribution;
