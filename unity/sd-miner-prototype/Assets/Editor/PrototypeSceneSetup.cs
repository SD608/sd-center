using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using SDMiner.Prototype;
namespace SDMiner.Prototype.Editor {
 public static class PrototypeSceneSetup {
   private const string ScenePath = "Assets/Scenes/SDMinerDev.unity";
   [MenuItem("SD Miner Sandbox/Create Development Scene")]
   public static void Create() {
     if (!AssetDatabase.IsValidFolder("Assets/Scenes"))
       AssetDatabase.CreateFolder("Assets", "Scenes");
     Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,
                                               NewSceneMode.Single);
     new GameObject("Development Bootstrap").AddComponent<PrototypeBootstrap>();
     EditorSceneManager.SaveScene(scene, ScenePath);
     EditorBuildSettings.scenes = new[] {
       new EditorBuildSettingsScene(ScenePath, true)
     };
     AssetDatabase.SaveAssets();
     Debug.Log("Development scene generated. No service integration.");
   }
   [MenuItem("SD Miner Sandbox/Build Windows Development Only")]
   public static void Build() {
     if (!System.IO.File.Exists(ScenePath)) {
       Debug.LogError("Create the development scene first.");
       return;
     }
     BuildPlayerOptions options = new BuildPlayerOptions {
       scenes = new[] { ScenePath },
       locationPathName = "Build/SDMinerPrototype.exe",
       target = BuildTarget.StandaloneWindows64,
       options = BuildOptions.Development
     };
     var report = BuildPipeline.BuildPlayer(options);
     Debug.Log("Development build result: " + report.summary.result);
   }
 }
}
