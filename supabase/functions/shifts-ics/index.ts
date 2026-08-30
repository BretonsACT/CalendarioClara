import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * iCal (.ics) feed for Clara's shift calendar.
 * Reads shifts from the public `shifts` table and renders an RFC 5545 feed
 * that Google Calendar can subscribe to. The feed always reflects the current
 * DB state (no caching).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Shift {
  date: string;
  shift_type: string;
  note: string | null;
  lunch_time?: string | null;
  dinner_time?: string | null;
}

// Shift type -> start time, end time (HH:MM, local Madrid time) and display label.
// 'vacation' and 'none' are intentionally absent: no events are emitted for them.
const SHIFT_MAP: Record<string, { start: string; end: string; label: string }> = {
  morning: { start: '08:00', end: '15:00', label: 'M (8h-15h)' },
  day: { start: '08:00', end: '20:00', label: 'D (8h-20h)' },
  afternoon: { start: '13:00', end: '20:00', label: 'T (13h-20h)' },
  night: { start: '20:00', end: '00:00', label: 'N (20h-8h)' },
  lunch: { start: '11:30', end: '15:30', label: 'Comida (11:30)' },
  dinner: { start: '20:30', end: '23:30', label: 'Cena (20:30)' },
};

/** Today as YYYY-MM-DD in the Europe/Madrid timezone (en-CA yields ISO format). */
function todayInMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Convert YYYY-MM-DD to YYYYMMDD. */
function toICSDate(dateStr: string): string {
  return dateStr.replace(/-/g, '');
}

/** Convert a Date to a UTC DTSTAMP in YYYYMMDDTHHMMSSZ format. */
function toUTCDatestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Add days to a YYYY-MM-DD date (arithmetic in UTC to avoid DST issues). */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Calculate an end time adding minutes to HH:MM (defaults to 2 hours if end calculation wraps or is needed). */
function addMinutesToTime(timeStr: string, minutes: number): { time: string; nextDay: boolean } {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newHour = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  const nextDay = newHour >= 24;
  const formattedHour = String(newHour % 24).padStart(2, '0');
  const formattedMin = String(remMinutes).padStart(2, '0');
  return { time: `${formattedHour}:${formattedMin}`, nextDay };
}

/** Escape a text value per RFC 5545 (backslash, semicolon, comma, newlines). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n');
}

/**
 * Fold a content line so every physical line is at most 75 octets, per RFC 5545
 * (fold by inserting CRLF + single space). Splits at UTF-8 codepoint boundaries
 * so multibyte characters are never broken.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const MAX = 75;
  const parts: string[] = [];
  let current = '';
  let currentLen = 0;
  for (const ch of Array.from(line)) {
    const chLen = encoder.encode(ch).length;
    if (currentLen + chLen > MAX) {
      parts.push(current);
      current = '';
      currentLen = 0;
    }
    current += ch;
    currentLen += chLen;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** Build the full iCalendar document from the filtered rows. */
function buildCalendar(rows: Shift[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalendarioClara//Turnos ES//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Clara Turnos y Salidas',
    'X-WR-TIMEZONE:Europe/Madrid',
  ];

  const dtStamp = toUTCDatestamp(new Date());

  for (const row of rows) {
    const shift = SHIFT_MAP[row.shift_type];
    if (!shift) continue; // skip 'vacation', 'none', and any unknown types

    let startTime = shift.start;
    let endTime = shift.end;
    let label = shift.label;

    if (row.shift_type === 'lunch') {
      const customTime = row.lunch_time && row.lunch_time.trim() !== '' ? row.lunch_time.trim() : '11:30';
      startTime = customTime;
      const endInfo = addMinutesToTime(customTime, 240); // 4 hours
      endTime = endInfo.time;
      label = `Comida (${customTime})`;
    } else if (row.shift_type === 'dinner') {
      const customTime = row.dinner_time && row.dinner_time.trim() !== '' ? row.dinner_time.trim() : '20:30';
      startTime = customTime;
      const endInfo = addMinutesToTime(customTime, 180); // 3 hours
      endTime = endInfo.time;
      label = `Cena (${customTime})`;
    }

    // Shift ends next day if end time is 00:00 or wraps
    const isNextDay = endTime === '00:00' || (row.shift_type === 'night');
    const endDate = isNextDay ? addDays(row.date, 1) : row.date;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:clara-shift-${row.date}@calendarioclara`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART;TZID=Europe/Madrid:${toICSDate(row.date)}T${startTime.replace(':', '')}00`);
    lines.push(`DTEND;TZID=Europe/Madrid:${toICSDate(endDate)}T${endTime.replace(':', '')}00`);
    lines.push(`SUMMARY:Clara - ${label}`);
    if (row.note && row.note.trim() !== '') {
      lines.push(`DESCRIPTION:${escapeText(row.note)}`);
    }
    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // CRLF line endings + trailing newline at the end of the output.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

Deno.serve(async (req) => {
  // CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data, error } = await supabase
      .from('shifts')
      .select('date, shift_type, note, lunch_time, dinner_time')
      .order('date', { ascending: true });

    if (error) {
      console.error('Database query error:', error);
      return new Response(`Error querying shifts: ${error.message}`, {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const todayStr = todayInMadrid();
    const rows = (data ?? []).filter((row) => row.date >= todayStr);
    const ics = buildCalendar(rows);

    return new Response(ics, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err) {
    console.error('Unhandled error in shifts-ics:', err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Internal server error: ${message}`, {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
});
