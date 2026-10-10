use serde::Deserialize;
use std::{sync::Mutex, time::Duration};
use tokio::sync::watch;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Decision {
    Checking,
    Pending,
    Allow,
    Deny,
    Busy,
    Unsupported,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub request_id: String,
    pub decision: Decision,
}

struct Pending {
    id: String,
    tx: watch::Sender<Decision>,
}
#[derive(Default)]
pub struct LeaveGate {
    pending: Mutex<Option<Pending>>,
}
impl LeaveGate {
    pub fn begin(&self) -> Result<(String, watch::Receiver<Decision>), String> {
        let mut pending = self.pending.lock().expect("leave lock poisoned");
        if pending.is_some() {
            return Err("另一个离开操作正在等待确认。".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = watch::channel(Decision::Checking);
        *pending = Some(Pending { id: id.clone(), tx });
        Ok((id, rx))
    }
    pub fn reply(&self, reply: Reply) -> bool {
        let pending = self.pending.lock().expect("leave lock poisoned");
        let Some(pending) = pending.as_ref().filter(|p| p.id == reply.request_id) else {
            return false;
        };
        let current = *pending.tx.borrow();
        if !matches!(current, Decision::Checking | Decision::Pending)
            || reply.decision == Decision::Checking
        {
            return false;
        }
        pending.tx.send(reply.decision).is_ok()
    }
    pub fn cancel(&self, id: &str) {
        let mut pending = self.pending.lock().expect("leave lock poisoned");
        if pending.as_ref().is_some_and(|p| p.id == id) {
            *pending = None;
        }
    }
}

/// A user reading a shown confirmation is not an unresponsive renderer.
pub async fn wait(mut rx: watch::Receiver<Decision>) -> Decision {
    wait_with_deadlines(&mut rx, Duration::from_secs(5), Duration::from_secs(120)).await
}

async fn wait_with_deadlines(
    rx: &mut watch::Receiver<Decision>,
    handshake: Duration,
    confirmation: Duration,
) -> Decision {
    let mut deadline = tokio::time::Instant::now() + handshake;
    let mut acknowledged = false;
    loop {
        let decision = *rx.borrow_and_update();
        match decision {
            Decision::Pending => {
                if !acknowledged {
                    deadline = tokio::time::Instant::now() + confirmation;
                    acknowledged = true;
                }
            }
            Decision::Checking => {}
            final_decision => return final_decision,
        }
        match tokio::time::timeout_at(deadline, rx.changed()).await {
            Ok(Ok(())) => {}
            _ => {
                return if acknowledged {
                    Decision::Deny
                } else {
                    Decision::Unsupported
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn replies_are_correlated_single_use_and_busy_is_not_consent() {
        let gate = LeaveGate::default();
        let (id, rx) = gate.begin().unwrap();
        assert!(gate.begin().is_err());
        assert!(!gate.reply(Reply {
            request_id: "stale".into(),
            decision: Decision::Allow
        }));
        assert!(gate.reply(Reply {
            request_id: id.clone(),
            decision: Decision::Pending
        }));
        assert!(gate.reply(Reply {
            request_id: id.clone(),
            decision: Decision::Busy
        }));
        assert!(!gate.reply(Reply {
            request_id: id.clone(),
            decision: Decision::Allow
        }));
        assert_eq!(wait(rx).await, Decision::Busy);
        gate.cancel(&id);
        assert!(!gate.reply(Reply {
            request_id: id,
            decision: Decision::Allow
        }));
        let (next, rx) = gate.begin().unwrap();
        assert!(gate.reply(Reply {
            request_id: next,
            decision: Decision::Deny
        }));
        assert_eq!(wait(rx).await, Decision::Deny);
    }
    #[tokio::test]
    async fn cancelled_wait_is_not_approval_and_completed_approval_is_explicit() {
        let gate = LeaveGate::default();
        let (timed, mut no_response) = gate.begin().unwrap();
        assert_eq!(
            wait_with_deadlines(
                &mut no_response,
                Duration::from_secs(2),
                Duration::from_secs(3)
            )
            .await,
            Decision::Unsupported
        );
        gate.cancel(&timed);
        let (id, rx) = gate.begin().unwrap();
        gate.cancel(&id);
        assert_eq!(wait(rx).await, Decision::Unsupported);
        let (id, rx) = gate.begin().unwrap();
        gate.reply(Reply {
            request_id: id,
            decision: Decision::Allow,
        });
        assert_eq!(wait(rx).await, Decision::Allow);
    }
}
