import type { LocaleContribution } from "./types.js";

/**
 * Korean (ko-KR). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=ko-KR, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const ko = {
  configurationAxes: {
    power: ["성능"],
    model: ["모델", "모델 선택"],
    effort: ["추론 수준", "추론 강도", "성능"],
    speed: ["속도"],
    advanced: ["고급"],
  },
  configurationOptions: {
    instant: ["즉시"],
    medium: ["중간"],
    high: ["높음"],
    extraHigh: ["매우 높음"],
    max: ["최대"],
    ultra: ["울트라"],
    fast: ["빠름"],
  },
  composerTextbox: ["ChatGPT와 채팅"],
  sendButton: ["프롬프트 보내기"],
  searchChatsButton: ["채팅 검색"],
  searchChatsPlaceholder: ["채팅 검색…"],
  newChat: ["새 채팅"],
  addFilesButton: ["파일 추가 및 기타"],
  addFilesOpenerCandidates: ["파일 추가 및 기타"],
  addPhotosFilesMenuItem: ["사진 및 파일 추가"],
  copyResponse: ["응답 복사"],
  modeLabels: ["즉시", "중간", "높음", "매우 높음"],
  modeOptions: {
    instant: ["즉시"],
    medium: ["중간"],
    high: ["높음"],
    extraHigh: ["매우 높음"],
  },
  modeOpenerExtra: ["구성…"],
  tools: {
    web_search: ["웹 검색"],
    deep_research: ["심층 리서치"],
    create_image: ["이미지 만들기"],
  },
  signedInMarkers: ["새 채팅", "채팅 검색", "최근", "채팅 기록", "프로젝트", "ChatGPT와 채팅"],
  responseActions: ["응답 복사"],
  stopControl: ["답변 중지"],
} satisfies LocaleContribution;
