/**
 * "Send feedback": testers report a bug or an idea without leaving the app.
 * It lands on the owner dashboard with the screen they were on.
 */
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import type { FeedbackKind } from '../../shared/types';
import { call } from '../api';
import { toast, toastError, view } from '../state';
import { Button, Modal, Segmented } from '../ui';

export const feedbackOpen = signal(false);

const PROMPTS: Record<FeedbackKind, string> = {
  bug: 'What did you do, what did you expect, and what happened instead?',
  idea: 'What would make InternIQ more useful for you?',
  other: 'Anything else you want to say.',
};

export function FeedbackModal() {
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => (feedbackOpen.value = false);
  const send = async () => {
    if (message.trim().length < 3) return;
    setBusy(true);
    try {
      await call('sendFeedback', {
        kind,
        message: message.trim(),
        page: view.value,
        device: `${navigator.userAgent.slice(0, 220)} · ${window.innerWidth}×${window.innerHeight}`,
      });
      toast('Thanks, your feedback was sent.');
      setMessage('');
      close();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Send feedback"
      onClose={close}
      footer={
        <>
          <span class="tiny muted" style={{ marginRight: 'auto' }}>
            Goes to the person who runs InternIQ.
          </span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={message.trim().length < 3} onClick={() => void send()}>
            Send
          </Button>
        </>
      }
    >
      <div class="stack" style={{ gap: 14 }}>
        <Segmented
          label="Type of feedback"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'bug', label: 'Something broke' },
            { value: 'idea', label: 'Idea' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <div class="field">
          <label for="fb-message">{PROMPTS[kind]}</label>
          <textarea
            id="fb-message"
            class="textarea"
            rows={6}
            maxLength={4000}
            value={message}
            onInput={(e) => setMessage((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
            }}
          />
          <div class="hint">We also include the screen you are on and your browser and window size, so layout bugs can be reproduced. Nothing from your jobs, notes or emails is attached.</div>
        </div>
      </div>
    </Modal>
  );
}
