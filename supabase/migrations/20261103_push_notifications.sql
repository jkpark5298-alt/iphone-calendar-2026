-- 일정 알림(푸시) 기능용. Supabase SQL Editor에서 한 번 실행한다.

-- 1) 일정별 알림 설정: '' 없음 / at 정시 / 10m 10분 전 / 1h 1시간 전 / 1d 전날 저녁 8시
alter table public.calendar_schedules
  add column if not exists remind text default '';

-- 2) 알림을 켠 기기(브라우저 구독) 목록. 서버(service role)만 읽고 쓴다.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) 이미 보낸 알림 기록(같은 알림을 두 번 보내지 않기 위함)
create table if not exists public.push_sent (
  schedule_id text not null,
  occurrence text not null,
  remind text not null,
  sent_at timestamptz not null default now(),
  primary key (schedule_id, occurrence, remind)
);

-- 브라우저(anon 키)에서는 접근하지 못하게 잠그고, 서버(service role)만 쓴다.
alter table public.push_subscriptions enable row level security;
alter table public.push_sent enable row level security;
