import * as ImagePicker from 'expo-image-picker';
import { toast } from '../../ui/Toast';

/**
 * Edit Profile's photo: the camera or the gallery, cropped square. Resolves the picked file's uri, or null when the
 * user cancelled (or the camera permission was refused, which says so). The Android gallery picker needs no permission.
 */
export async function pickPhoto(source: 'camera' | 'gallery'): Promise<string | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      toast('Camera access is off. Allow it in Settings to take a photo.');
      return null;
    }
  }
  const options = { mediaTypes: ['images'] as ImagePicker.MediaType[], allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.6 };
  const result = await (source === 'camera' ? ImagePicker.launchCameraAsync(options) : ImagePicker.launchImageLibraryAsync(options));
  return result.canceled ? null : result.assets[0].uri;
}
