using System;
using System.Threading.Tasks;

namespace SDMiner.Prototype {
    // DEVELOPMENT-ONLY contract: no Center session bridge and no Core payment APIs.
    public enum EconomyConnectionState { NotConnected, AwaitingServerAuthority, VerifiedReadOnly }

    [Serializable]
    public sealed class EconomyReadOnlySnapshot {
        public EconomyConnectionState State;
        public string DisplayMessage;
        public int CurrentRunEligibleScore;
        public int EstimatedNextThreshold;
        public int ServerConfirmedMinerCoins;
        public string ServerRuleVersion;
        public bool HasVerifiedServerEvidence;
    }

    public interface IEconomyReadOnlyGateway {
        Task<EconomyReadOnlySnapshot> RequestAuthoritativeReadAsync(string runId);
    }

    // New Unity project MUST NOT invent payout, item ownership or wallet mutations.
    public sealed class FailClosedEconomyGateway : IEconomyReadOnlyGateway {
        public Task<EconomyReadOnlySnapshot> RequestAuthoritativeReadAsync(string runId) {
            return Task.FromResult(new EconomyReadOnlySnapshot {
                State = EconomyConnectionState.NotConnected,
                DisplayMessage = "SD Core 정산 연결 전 — 주화 지급/잔액을 확정할 수 없음",
                CurrentRunEligibleScore = 0,
                EstimatedNextThreshold = 0,
                ServerConfirmedMinerCoins = 0,
                ServerRuleVersion = "",
                HasVerifiedServerEvidence = false
            });
        }
    }
}
