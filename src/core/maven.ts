/** Maven 坐标工具（独立文件，避免 version / version-json 循环引用） */

/** group:artifact:version[:classifier] -> 相对 maven 路径 */
export function mavenRelativePath(name: string): string | null {
  const parts = name.split(':')
  if (parts.length < 3) return null
  const [group, artifact, version, classifier] = parts
  const filename = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`
  return `${group.split('.').join('/')}/${artifact}/${version}/${filename}`
}
