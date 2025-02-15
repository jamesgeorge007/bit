import R from 'ramda';
import Command from '../../command';
import { getComponentLogs } from '../../../api/consumer';
import { paintLog } from '../../chalk-box';
import { BASE_DOCS_DOMAIN } from '../../../constants';

export default class Log extends Command {
  name = 'log <id>';
  description = `show components(s) tag history.\n  https://${BASE_DOCS_DOMAIN}/docs/view#log`;
  alias = '';
  opts = [];
  migration = true;

  action([id]: [string]): Promise<any> {
    return getComponentLogs(id).then(logs => {
      Object.keys(logs).forEach(key => (logs[key].tag = key));
      return R.reverse(R.values(logs)).map(
        R.evolve({
          date: n => new Date(parseInt(n)).toLocaleString()
        })
      );
    });
  }

  report(
    logs: Array<{
      message: string;
      tag: string;
      date: string;
      username: string | null | undefined;
      email: string | null | undefined;
    }>
  ): string {
    return logs.map(paintLog).join('\n');
  }
}
