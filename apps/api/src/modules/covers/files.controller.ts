import { Controller, Get, Header, Inject, NotFoundException, Param, StreamableFile } from '@nestjs/common';
import { Public } from '../../common/decorators/index.js';
import { StorageService } from '../storage/storage.service.js';

@Controller('files')
export class FilesController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** Cover images are public (they appear on the QR page too). */
  @Public()
  @Get('covers/:titleId/:file')
  @Header('Cache-Control', 'public, max-age=86400')
  async cover(@Param('titleId') titleId: string, @Param('file') file: string) {
    if (!/^[0-9a-f-]{36}$/.test(titleId) || !/^(400|160)\.webp$/.test(file)) throw new NotFoundException();
    const data = await this.storage.get(`covers/${titleId}/${file}`);
    if (!data) throw new NotFoundException();
    return new StreamableFile(data, { type: 'image/webp' });
  }
}
