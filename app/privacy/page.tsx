import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  robots: { index: false, follow: false },
};

/** Google OAuth 앱 게시에 필요한 개인정보처리방침 페이지 */
export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 64px", lineHeight: 1.7, fontSize: 15 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>개인정보처리방침</h1>
      <p style={{ color: "#64748b", marginTop: 0 }}>iphone-calendar-drive · 시행일 2026-10-21</p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>1. 앱 소개</h2>
      <p>
        이 앱(2026 아이폰 캘린더·일기장)은 운영자 본인이 일기, 일정, 사진, 정보 수집을 기록하기 위해 사용하는 개인용
        웹앱입니다.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>2. Google 계정으로 접근하는 정보</h2>
      <ul>
        <li>
          <b>Google Drive (drive.file 권한)</b>: 앱의 저장 공간이 부족할 때, 앱이 만든 사진 압축본을 사용자 Drive의
          「개인 앨범」 폴더에 저장하고 다시 불러옵니다. 이 앱이 만든 파일 외의 Drive 파일은 읽거나 수정할 수 없습니다.
        </li>
        <li>
          <b>계정 이메일 주소</b>: 연결된 Google 계정이 바뀌지 않았는지 확인하는 용도로만 사용합니다.
        </li>
      </ul>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>3. 보관과 공유</h2>
      <ul>
        <li>Drive 연결 정보(갱신 토큰)는 앱의 비공개 저장소에만 보관하며 외부에 공개하지 않습니다.</li>
        <li>수집한 정보를 제3자에게 판매하거나 제공하지 않으며, 광고에 사용하지 않습니다.</li>
        <li>Google API로 받은 정보의 사용은 Google API 서비스 사용자 데이터 정책(제한적 사용 요건 포함)을 따릅니다.</li>
      </ul>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>4. 연결 해제와 삭제</h2>
      <p>
        Google 계정 → 보안 → 타사 앱 및 서비스에서 「iphone-calendar-drive」의 액세스를 언제든 삭제할 수 있습니다. Drive에
        저장된 사진은 「개인 앨범」 폴더에서 직접 지울 수 있습니다.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>5. 문의</h2>
      <p>jkpark314@gmail.com</p>
    </main>
  );
}
