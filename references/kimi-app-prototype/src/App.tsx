import { useRoomStore } from '@/store/useRoomStore';
import { BackgroundEffect } from '@/components/BackgroundEffect';
import { JoinRoomForm } from '@/components/JoinRoomForm';
import { WaitingRoom } from '@/components/WaitingRoom';
import { ChatRoom } from '@/components/ChatRoom';
import { DestroyedRoom } from '@/components/DestroyedRoom';
import { RoomUnavailable } from '@/components/RoomUnavailable';

function App() {
  const roomState = useRoomStore((s) => s.roomState);

  const renderContent = () => {
    switch (roomState) {
      case 'idle':
        return <JoinRoomForm />;
      case 'joining':
        return <JoinRoomForm />;
      case 'waiting':
        return <WaitingRoom />;
      case 'active':
      case 'hidden':
        return <ChatRoom />;
      case 'destroyed':
        return <DestroyedRoom />;
      case 'unavailable':
      case 'disconnected':
        return <RoomUnavailable />;
      default:
        return <JoinRoomForm />;
    }
  };

  return (
    <div className="relative min-h-screen bg-[#050505] overflow-hidden">
      <BackgroundEffect />
      {renderContent()}
    </div>
  );
}

export default App;
