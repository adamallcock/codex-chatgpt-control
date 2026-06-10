import type { LocaleContribution } from "./types.js";

/**
 * Thai (th-TH). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=th-TH, Google Translate confirmed off).
 *
 * Omitted because they match English case-insensitively: `modeLabels` (Instant / Thinking / Pro).
 * Not yet captured — fall back to English + `selector_drift`: `download`, `downloadImage`,
 * `imageContainerHint`, `transientAssistant`, `stopControl`, and the login/captcha/rate-limit
 * blocker copy.
 */
export const th = {
  composerTextbox: ["ถามอะไรก็ได้"],
  sendButton: ["ส่งคำสั่ง"],
  searchChatsButton: ["ค้นหาแชต"],
  searchChatsPlaceholder: ["ค้นหาแชต..."],
  newChat: ["แชตใหม่"],
  addFilesButton: ["เพิ่มไฟล์และอื่นๆ"],
  addFilesOpenerCandidates: ["เพิ่มไฟล์และอื่นๆ"],
  addPhotosFilesMenuItem: ["อัปโหลดรูปและไฟล์"],
  copyResponse: ["คัดลอกคำตอบ"],
  modeOpenerExtra: ["กำหนดค่า..."],
  tools: {
    web_search: ["ค้นหาเว็บ"],
    deep_research: ["หาข้อมูลเชิงลึก"],
    create_image: ["สร้างรูปภาพ"],
  },
  signedInMarkers: ["แชตใหม่", "ค้นหาแชต", "เมื่อเร็วๆ นี้", "ประวัติการแชต", "โครงการ", "ถามอะไรก็ได้"],
  responseActions: ["คัดลอกคำตอบ"],
} satisfies LocaleContribution;
