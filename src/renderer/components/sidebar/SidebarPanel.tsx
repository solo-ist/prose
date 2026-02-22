import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { ChatPanel } from '../chat/ChatPanel'
import { InfoPanel } from './InfoPanel'
import { useReviewMode } from '../../stores/reviewStore'

export function SidebarPanel() {
  const reviewMode = useReviewMode()

  // Review mode owns the full sidebar — hide tab bar, show chat only
  if (reviewMode) {
    return <ChatPanel />
  }

  return (
    <Tabs defaultValue="chat" className="flex h-full flex-col">
      <TabsList className="mx-3 mt-3 mb-0 shrink-0">
        <TabsTrigger value="info">Info</TabsTrigger>
        <TabsTrigger value="chat">Chat</TabsTrigger>
      </TabsList>
      <TabsContent value="info" className="flex-1 min-h-0 overflow-hidden mt-0">
        <InfoPanel />
      </TabsContent>
      <TabsContent value="chat" className="flex-1 min-h-0 overflow-hidden mt-0 data-[state=inactive]:hidden" forceMount>
        <ChatPanel />
      </TabsContent>
    </Tabs>
  )
}
