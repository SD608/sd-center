using System.Threading.Tasks;
namespace SDMiner.Prototype {
  // DRAFT. Never sends a real credential; verified bridge/Run auth are missing.
  public enum JoinOutcome { BridgeNotConnected, HoldLedger, HoldLocation, Expired, Authorized }
  public struct JoinRequest { public string RunId; public string RequestId; }
  public interface IRunGateway { Task<JoinOutcome> RequestJoinAsync(JoinRequest request); }
  public sealed class FailClosedRunGateway : IRunGateway {
    public Task<JoinOutcome> RequestJoinAsync(JoinRequest request) {
      return Task.FromResult(JoinOutcome.BridgeNotConnected);
    }
  }
}
