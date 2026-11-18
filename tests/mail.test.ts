import { describe, expect, it } from 'vitest';
import { classifyMail, extractDue, guessCompany, mailQueries, parseFrom, type RawMail } from '../src/server/mail/classify';
import { buildEvents, icsCalendar, monthGrid } from '../src/shared/calendar';

const NOW = '2026-11-17T09:00:00.000Z';
const mail = (p: Partial<RawMail>): RawMail => ({ id: 'abc12345', threadId: 'abc12346', from: 'X <x@example.com>', subject: '', date: NOW, snippet: '', body: '', ...p });

describe('dates in emails', () => {
  it('reads Indian and international formats with times', () => {
    expect(extractDue('Complete the test by 21 November 2026, 6:00 PM IST', NOW, 'assessment')).toEqual({ due: '2026-11-21T18:00', allDay: false });
    expect(extractDue('Interview scheduled on Nov 19, 2026 at 3:30 pm', NOW, 'interview')).toEqual({ due: '2026-11-19T15:30', allDay: false });
    expect(extractDue('Last date: 25/11/2026', NOW, 'deadline')).toEqual({ due: '2026-11-25', allDay: true });
    expect(extractDue('deadline 2026-12-15 17:00', NOW, 'deadline')).toEqual({ due: '2026-12-15T17:00', allDay: false });
  });

  it('infers the year and rolls into next year', () => {
    expect(extractDue('Register before 3rd December', NOW, 'eligible').due).toBe('2026-12-03');
    expect(extractDue('Submit by 15 Jan', NOW, 'deadline').due).toBe('2027-01-15');
  });

  it('ignores past dates and dates with no action words in passive categories', () => {
    expect(extractDue('Applications closed on 1 November 2026', NOW, 'deadline').due).toBe('');
    expect(extractDue('We received your application on 18 November 2026.', NOW, 'applied').due).toBe('');
  });
});

describe('email triage', () => {
  it('parses senders', () => {
    expect(parseFrom('"Acme Careers" <jobs@acme.com>')).toEqual({ name: 'Acme Careers', address: 'jobs@acme.com', domain: 'acme.com' });
    expect(parseFrom('plain@example.org').domain).toBe('example.org');
  });

  it('guesses the company from subject, display name or domain', () => {
    expect(guessCompany('Thank you for applying to Lumen Labs', 'Recruiting', 'greenhouse.io')).toBe('Lumen Labs');
    expect(guessCompany('Update on your application', 'Sable Security Careers', 'sablesecurity.io')).toBe('Sable Security');
    expect(guessCompany('Your application', '', 'mail.northwind.ai')).toBe('Northwind');
    expect(guessCompany('Northwind AI: Machine Learning Intern | Registration open', 'Placement Cell GGSIPU', 'ipu.ac.in')).toBe('Northwind AI');
  });

  it('maps the placement pipeline like the Placement Tracker routine', () => {
    const c = (subject: string, body = '', from = 'Acme Careers <careers@acme.com>') => classifyMail(mail({ subject, body, from }));
    expect(c('Thank you for applying to Acme').suggestedStage).toBe('applied');
    expect(c('Acme online assessment', 'Please complete the HackerRank test by 20 Nov 2026').suggestedStage).toBe('interviewing');
    expect(c('Interview invitation').category).toBe('interview');
    expect(c('Update', 'Unfortunately, we will not be moving forward with your application.').suggestedStage).toBe('rejected');
    expect(c('Offer letter: Software Engineering Intern').suggestedStage).toBe('offer');
    const pod = c('Northwind AI: ML Intern | Registration open', 'Register on POD before 21 November 2026', 'CPC <cpc@ipu.ac.in>');
    expect(pod).toMatchObject({ category: 'eligible', area: 'internships', suggestedStage: 'saved', due: '2026-11-21' });
    expect(pod.taskTitle).toMatch(/^Register: Northwind AI/);
  });

  it('drops noise but keeps LinkedIn application confirmations', () => {
    expect(classifyMail(mail({ subject: '30+ new jobs for "ml intern"', from: 'LinkedIn <jobalerts-noreply@linkedin.com>' })).noise).toBe(true);
    expect(classifyMail(mail({ subject: 'Your OTP is 123456' })).noise).toBe(true);
    expect(classifyMail(mail({ subject: 'IBM-associated training & internship program', from: 'Corizo <hi@corizo.in>' })).noise).toBe(true);
    const sent = classifyMail(mail({ subject: 'Your application was sent to Acme', from: 'LinkedIn <jobs-noreply@linkedin.com>' }));
    expect(sent.noise).toBe(false);
    expect(sent.category).toBe('applied');
  });

  it("ignores InternIQ's own digest emails, even from the student's own address", () => {
    const digest = classifyMail(
      mail({
        subject: '12 new internship matches (75+) · 1 due soon',
        from: 'InternIQ <student@gmail.com>',
        body: 'Due in the next 2 days: Fri 20 Nov Check passport is valid through 2028 (apply/renew if not). New matches: ML Intern at Acme',
      }),
      { extraSenders: ['gmail.com'] },
    );
    expect(digest).toMatchObject({ noise: true, important: false });
    expect(classifyMail(mail({ subject: '2 things due in the next 2 days', from: 'Me <student@gmail.com>' })).noise).toBe(true);
    // A real admissions email that mentions matches is still kept.
    expect(classifyMail(mail({ subject: 'MSc application: 3 new documents uploaded', from: 'MBZUAI Admissions <admissions@mbzuai.ac.ae>' })).noise).toBe(false);
  });

  it('routes admissions and exam emails to their sections', () => {
    const adm = classifyMail(mail({ subject: 'Reminder to submit your recommendation letters', body: 'Referees must submit before the application deadline of 15 December 2026.', from: 'MBZUAI Admissions <admissions@mbzuai.ac.ae>' }));
    expect(adm).toMatchObject({ area: 'studies', due: '2026-12-15' });
    const exam = classifyMail(mail({ subject: 'Admit card released', from: 'UPSC <noreply@upsc.gov.in>' }));
    expect(exam).toMatchObject({ category: 'exam', area: 'exams' });
  });

  it('builds Gmail queries including extra senders', () => {
    const q = mailQueries(3, ['prof@uni.edu']);
    expect(q.every((x) => x.includes('newer_than:3d'))).toBe(true);
    expect(q.at(-1)).toContain('prof@uni.edu');
    expect(q[1]).toContain('cpc@ipu.ac.in');
  });
});

describe('calendar', () => {
  it('merges every dated thing and skips closed items', () => {
    const events = buildEvents({
      jobs: [
        { id: 'j_1', role: 'ML Intern', company: 'Acme', stage: 'saved', deadline: '2026-11-20', followUpAt: '', url: '' } as never,
        { id: 'j_2', role: 'Old', company: 'B', stage: 'rejected', deadline: '2026-11-21', followUpAt: '', url: '' } as never,
      ],
      programs: [{ id: 'p_1', name: 'MSc NLP', org: 'MBZUAI', stage: 'preparing', deadline: '2026-12-15', confirmed: true, fit: 'top', url: '' } as never],
      exams: [{ id: 'x_1', name: 'UPSC CSE 2027', body: 'UPSC', stage: 'watching', confidence: 'official', url: '', events: [{ label: 'Prelims', date: '2027-05-23', precision: 'day' }, { label: 'Notification (expected)', date: '2027-01-13', precision: 'day' }] } as never],
      tasks: [{ id: 't_1', title: 'Book IELTS', due: '2026-11-21T10:00', area: 'studies', status: 'todo', source: 'roadmap', link: '' } as never],
    });
    expect(events.map((e) => e.id)).toEqual(['apply:j_1', 'task:t_1', 'program:p_1', 'exam:x_1:1', 'exam:x_1:0']);
    expect(events.find((e) => e.id === 'task:t_1')!.time).toBe('10:00');
    expect(events.find((e) => e.id === 'exam:x_1:1')!.approx).toBe(true);
    const ics = icsCalendar(events, new Date('2026-11-17T00:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261120');
    expect(ics).toContain('DTSTART;TZID=Asia/Kolkata:20261121T100000');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(5);
  });

  it('makes Monday-first month grids', () => {
    const g = monthGrid(2026, 10);
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-10-26');
    expect(g).toContain('2026-11-30');
  });
});
