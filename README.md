# MockAR web page

Marker cube recognition in the browser. Open the page on a phone, allow the camera and
point it at the six-marker cube: the page finds the faces, estimates the box pose and draws
an overlay you can tap, long-press and swipe.

Everything runs on the device. There is no backend and no external CDN, so these files can be
served by any static host. The camera needs https (or localhost).

Generated from `Assets/MockAR/Web` in the Unity project by `publish-web.cjs`.
Edit the source there, not these files.

## Credits

- Marker recognition: [js-aruco](https://github.com/jcmellado/js-aruco) (MIT, see `vendor/LICENSE.txt`)
- Switch model: Button Switch by Zoe XR
