import type { LocaleContribution } from "./types.js";

/**
 * Thai (th-TH). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=th-TH, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10 and stop-control labels updated 2026-06-15 from visible ChatGPT Pro sessions.
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
  modeLabels: ["ทันที", "ปานกลาง", "สูง", "สูงมาก"],
  modeOptions: {
    instant: ["ทันที"],
    medium: ["ปานกลาง"],
    high: ["สูง"],
    extraHigh: ["สูงมาก"],
  },
  modeOpenerExtra: ["กำหนดค่า..."],
  tools: {
    web_search: ["ค้นหาเว็บ"],
    deep_research: ["หาข้อมูลเชิงลึก"],
    create_image: ["สร้างรูปภาพ"],
  },
  signedInMarkers: ["แชตใหม่", "ค้นหาแชต", "เมื่อเร็วๆ นี้", "ประวัติการแชต", "โครงการ", "ถามอะไรก็ได้"],
  responseActions: ["คัดลอกคำตอบ"],
  stopControl: ["หยุดตอบ"],
} satisfies LocaleContribution;
