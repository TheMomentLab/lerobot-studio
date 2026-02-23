#!/usr/bin/env python3

def main():
    from lestudio.camera_patch import install_camera_patch
    install_camera_patch()
    from lerobot.scripts import lerobot_teleoperate as teleop_mod
    teleop_mod.main()

if __name__ == "__main__":
    main()
