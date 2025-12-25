import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function Documents() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          文档中心
        </h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          查看和管理文档
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>文档列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center rounded-lg border-2 border-dashed border-neutral-200 dark:border-neutral-800">
            <p className="text-neutral-500 dark:text-neutral-400">
              文档内容区域
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
