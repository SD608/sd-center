using UnityEngine;
namespace SDMiner.Prototype {
 // This scene only demonstrates independent Unity initialization.
 public sealed class PrototypeBootstrap : MonoBehaviour {
   private static Sprite CreatePixel() {
     var texture = new Texture2D(1, 1);
     texture.SetPixel(0, 0, Color.white);
     texture.Apply();
     return Sprite.Create(texture, new Rect(0, 0, 1, 1),
                          new Vector2(.5f, .5f), 1f);
   }
   private void Awake() {
     var cameraObject = new GameObject("Camera");
     cameraObject.tag = "MainCamera";
     var camera = cameraObject.AddComponent<Camera>();
     camera.orthographic = true;
     camera.orthographicSize = 5f;
     camera.backgroundColor = Color.black;
     camera.transform.position = new Vector3(0, 0, -10);

     var player = new GameObject("Local Sandbox Avatar");
     player.transform.position = Vector3.zero;
     var renderer = player.AddComponent<SpriteRenderer>();
     renderer.sprite = CreatePixel();
     renderer.color = Color.yellow;
     player.AddComponent<PrototypeMovement>();
   }
   private void OnGUI() {
     GUILayout.Label("SD Miner Unity 2D Development Prototype");
     GUILayout.Label("Run authentication and rewards: NOT CONNECTED");
     GUILayout.Label("Move with arrows or A/D; this is not the final game.");
   }
 }
}
