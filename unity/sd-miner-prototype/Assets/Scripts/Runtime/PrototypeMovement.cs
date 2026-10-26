using UnityEngine;
namespace SDMiner.Prototype {
 public sealed class PrototypeMovement : MonoBehaviour {
   // Local development-only movement. Never updates authoritative Run state.
   private void Update() {
     float horizontal = Input.GetAxisRaw("Horizontal");
     transform.position += new Vector3(horizontal * Time.deltaTime * 4f, 0f, 0f);
   }
 }
}
