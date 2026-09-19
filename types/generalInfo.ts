export type GeneralInfoInputType = "text" | "image" | "video" | "url";

export type GeneralInfoFileType = "none" | "image" | "video";

export interface GeneralInfoMediaItem {
  id: number;
  name: string;
  type: GeneralInfoFileType;
  preview: string;
  storagePath?: string;
  /** @deprecated fileUrl 사용 권장 */
  url?: string;
  fileUrl?: string;
  memo?: string;
}

export type GeneralInfoFactCheckStatus =
  | "확인 전"
  | "확인 필요"
  | "확인 완료"
  | "오류 가능성";

export interface GeneralInfoItem {
  id: number;
  title: string;
  inputTypes: GeneralInfoInputType[];
  text: string;
  sourceUrl?: string;
  fileName?: string;
  filePreview?: string;
  mediaItems?: GeneralInfoMediaItem[];
  primaryCategory: string;
  secondaryCategory: string;
  thirdCategory: string;
  keywords: string[];
  factCheckStatus: GeneralInfoFactCheckStatus;
  factCheckSummary: string;
  summary: string;
  extraNote?: string;
  formattedTextHtml?: string;
  /** 본문 단락 (최신 단락이 앞). 없으면 formattedTextHtml/text에서 복원 */
  paragraphs?: GeneralInfoParagraph[];
  confirmed: boolean;
  createdAt: string;
  isPinned?: boolean;
  /** PDF 저장(다운로드/공유)을 한 적 있으면 목록에 세모(▲) 표시 */
  pdfSaved?: boolean;
  /** 앱파일 저장을 한 적 있으면 목록에 별표(★) 표시 */
  appFileSaved?: boolean;
}

export interface GeneralInfoParagraph {
  id: string;
  html: string;
  text: string;
  createdAt: string;
}

export interface GeneralInfoDraft {
  title: string;
  text: string;
  sourceUrl: string;
  fileName: string;
  filePreview: string;
  storagePath?: string;
  url?: string;
  fileType: GeneralInfoFileType;
  mediaItems: GeneralInfoMediaItem[];
  primaryCategory: string;
  secondaryCategory: string;
  thirdCategory: string;
  keywords: string[];
  summary: string;
  factCheckStatus: GeneralInfoFactCheckStatus;
  factCheckSummary: string;
  formattedTextHtml?: string;
  paragraphs?: GeneralInfoParagraph[];
  isPinned?: boolean;
}
